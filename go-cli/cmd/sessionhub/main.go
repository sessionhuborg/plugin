package main

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	pb "github.com/sessionhuborg/plugin/go-cli/proto"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type config struct {
	User struct {
		APIKey string `json:"apiKey"`
	} `json:"user"`
	BackendGRPCURL string `json:"backendGrpcUrl"`
	GRPCUseTLS     *bool  `json:"grpcUseTls"`
}

type healthResult struct {
	OK               bool   `json:"ok"`
	BackendReachable bool   `json:"backendReachable"`
	Backend          string `json:"backend"`
	TLS              bool   `json:"tls"`
	LatencyMS        int64  `json:"latencyMs"`
	Configured       bool   `json:"configured"`
	Authenticated    bool   `json:"authenticated"`
	UserEmail        string `json:"userEmail,omitempty"`
	Error            string `json:"error,omitempty"`
}

type hookInput struct {
	SessionID string `json:"session_id"`
	Cwd       string `json:"cwd"`
}

type hookOutput struct {
	HookSpecificOutput struct {
		HookEventName     string `json:"hookEventName"`
		AdditionalContext string `json:"additionalContext"`
	} `json:"hookSpecificOutput"`
}

type apiClient struct {
	conn   *grpc.ClientConn
	client pb.SessionHubServiceClient
	apiKey string
}

type parsedSession struct {
	SessionID              string
	StartTime              string
	EndTime                string
	Cwd                    string
	GitBranch              string
	ToolName               string
	Interactions           []*pb.InteractionData
	TotalInputTokens       int64
	TotalOutputTokens      int64
	TotalCacheCreateTokens int64
	TotalCacheReadTokens   int64
	PlanSlug               string
}

type lastSessionInfo struct {
	SessionID   string `json:"sessionId"`
	ProjectPath string `json:"projectPath"`
	ProjectName string `json:"projectName"`
	CapturedAt  string `json:"capturedAt"`
}

var (
	uuidPattern      = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	sessionIDPattern = regexp.MustCompile(`"sessionId"\s*:\s*"([a-f0-9-]{36})"`)
	timestampPattern = regexp.MustCompile(`"timestamp"\s*:\s*"([^"]+)"`)
	frontmatterRegex = regexp.MustCompile(`(?s)^---\n(.*?)\n---\n(.*)$`)
	fmNameRegex      = regexp.MustCompile(`(?m)^name:\s*(.+)$`)
	fmDescRegex      = regexp.MustCompile(`(?m)^description:\s*(.+)$`)
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(2)
	}

	switch os.Args[1] {
	case "health":
		os.Exit(runHealth(os.Args[2:]))
	case "setup":
		os.Exit(runSetup(os.Args[2:]))
	case "capture":
		os.Exit(runCapture(os.Args[2:]))
	case "import-all":
		os.Exit(runImportAll(os.Args[2:]))
	case "observations":
		os.Exit(runObservations(os.Args[2:]))
	case "sync-skills":
		os.Exit(runSyncSkills(os.Args[2:]))
	case "push-skill":
		os.Exit(runPushSkill(os.Args[2:]))
	case "hook":
		os.Exit(runHook(os.Args[2:]))
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", os.Args[1])
		printUsage()
		os.Exit(2)
	}
}

func printUsage() {
	fmt.Println("sessionhub - standalone CLI")
	fmt.Println("")
	fmt.Println("Usage:")
	fmt.Println("  sessionhub setup --api-key <key>")
	fmt.Println("  sessionhub health [--json]")
	fmt.Println("  sessionhub capture [--project <name>] [--session <name>] [--transcript <path>] [--project-path <path>] [--session-id <id>] [--last <n>] [--json]")
	fmt.Println("  sessionhub import-all [--path <path>] [--project <name>] [--json]")
	fmt.Println("  sessionhub observations [--project <name>] [--session-id <id>] [--limit <n>] [--json]")
	fmt.Println("  sessionhub sync-skills [--team <id>] [--project <id>] [--scope <team|project>] [--json]")
	fmt.Println("  sessionhub push-skill --file <path> | --dir <path> [--team <id>] [--title <title>] [--category <cat>] [--tags a,b] [--summary <s>] [--json]")
	fmt.Println("  sessionhub hook session-start")
	fmt.Println("  sessionhub hook session-start-context")
	fmt.Println("  sessionhub hook session-start-clear-capture")
	fmt.Println("  sessionhub hook session-end")
}

func runSetup(args []string) int {
	fs := flag.NewFlagSet("setup", flag.ContinueOnError)
	apiKey := fs.String("api-key", "", "SessionHub API key")
	jsonOutput := fs.Bool("json", false, "Emit JSON output")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if strings.TrimSpace(*apiKey) == "" {
		emitSetupError(*jsonOutput, "api key is required: setup --api-key <key>")
		return 1
	}

	cfg, _ := loadConfig()
	cfg.User.APIKey = strings.TrimSpace(*apiKey)
	if strings.TrimSpace(cfg.BackendGRPCURL) == "" {
		cfg.BackendGRPCURL = "plugin.sessionhub.dev"
	}

	client, err := newAPIClient(cfg, cfg.User.APIKey, 10*time.Second)
	if err != nil {
		emitSetupError(*jsonOutput, fmt.Sprintf("failed to reach backend: %v", err))
		return 1
	}
	defer client.Close()

	user, err := client.ValidateAPIKey(10 * time.Second)
	if err != nil {
		emitSetupError(*jsonOutput, err.Error())
		return 1
	}
	if user == nil {
		emitSetupError(*jsonOutput, "invalid API key")
		return 1
	}

	if err := saveConfig(cfg); err != nil {
		emitSetupError(*jsonOutput, fmt.Sprintf("failed to save config: %v", err))
		return 1
	}

	if *jsonOutput {
		payload := map[string]any{
			"success":    true,
			"message":    "SessionHub configured successfully",
			"email":      user.Email,
			"configPath": configPath(),
		}
		_ = json.NewEncoder(os.Stdout).Encode(payload)
		return 0
	}

	fmt.Println("SessionHub configured successfully")
	fmt.Printf("User: %s\n", user.Email)
	fmt.Printf("Config: %s\n", configPath())
	return 0
}

func runHealth(args []string) int {
	fs := flag.NewFlagSet("health", flag.ContinueOnError)
	jsonOutput := fs.Bool("json", false, "Emit JSON output")
	timeout := fs.Duration("timeout", 8*time.Second, "Request timeout")
	if err := fs.Parse(args); err != nil {
		return 2
	}

	cfg, _ := loadConfig()
	backend := cfg.BackendGRPCURL
	if strings.TrimSpace(backend) == "" {
		backend = "plugin.sessionhub.dev"
	}
	addr := withDefaultPort(backend)
	useTLS := resolveTLS(addr, cfg.GRPCUseTLS)

	result := healthResult{Backend: addr, TLS: useTLS, Configured: strings.TrimSpace(cfg.User.APIKey) != ""}
	start := time.Now()
	client, err := newAPIClient(cfg, cfg.User.APIKey, *timeout)
	if err != nil {
		result.OK = false
		result.BackendReachable = false
		result.Error = fmt.Sprintf("dial failed: %v", err)
		result.LatencyMS = time.Since(start).Milliseconds()
		return emitHealth(result, *jsonOutput)
	}
	defer client.Close()

	result.BackendReachable = true
	result.LatencyMS = time.Since(start).Milliseconds()
	result.OK = true

	if result.Configured {
		user, validateErr := client.ValidateAPIKey(*timeout)
		if validateErr != nil {
			result.OK = false
			result.Authenticated = false
			result.Error = fmt.Sprintf("api key validation failed: %v", validateErr)
		} else if user == nil {
			result.Authenticated = false
			result.Error = "configured API key is invalid"
		} else {
			result.Authenticated = true
			result.UserEmail = user.Email
		}
	}

	return emitHealth(result, *jsonOutput)
}

func runCapture(args []string) int {
	fs := flag.NewFlagSet("capture", flag.ContinueOnError)
	projectName := fs.String("project", "", "Project name")
	sessionName := fs.String("session", "", "Session name")
	transcriptPath := fs.String("transcript", "", "Transcript JSONL path")
	lastExchanges := fs.Int("last", 0, "Only keep last N prompt-response exchanges")
	apiKeyOverride := fs.String("api-key", "", "API key override")
	projectPath := fs.String("project-path", "", "Project path")
	sessionID := fs.String("session-id", "", "Session ID")
	jsonOutput := fs.Bool("json", false, "Emit JSON output")
	if err := fs.Parse(args); err != nil {
		return 2
	}

	_, client, user, err := initializeAuthenticatedClient(*apiKeyOverride, 15*time.Second)
	if err != nil {
		return emitError(err, *jsonOutput)
	}
	defer client.Close()
	_ = user

	resolvedProjectPath := strings.TrimSpace(*projectPath)
	if resolvedProjectPath == "" {
		if cwd, cwdErr := os.Getwd(); cwdErr == nil {
			resolvedProjectPath = cwd
		}
	}
	if resolvedProjectPath == "" {
		return emitError(errors.New("could not resolve project path"), *jsonOutput)
	}

	resolvedTranscript := strings.TrimSpace(*transcriptPath)
	if resolvedTranscript == "" {
		found, findErr := findLatestTranscriptFile(resolvedProjectPath, strings.TrimSpace(*sessionID))
		if findErr != nil {
			return emitError(findErr, *jsonOutput)
		}
		if found == "" {
			return emitError(errors.New("no transcript files found for project"), *jsonOutput)
		}
		resolvedTranscript = found
	}

	parsed, parseErr := parseTranscriptFile(resolvedTranscript, *lastExchanges)
	if parseErr != nil {
		return emitError(parseErr, *jsonOutput)
	}

	finalProjectName := strings.TrimSpace(*projectName)
	if finalProjectName == "" {
		finalProjectName = filepath.Base(resolvedProjectPath)
	}

	project, err := ensureProject(client, finalProjectName, resolvedProjectPath, parsed.GitBranch)
	if err != nil {
		return emitError(err, *jsonOutput)
	}

	finalSessionName := strings.TrimSpace(*sessionName)
	if finalSessionName == "" {
		finalSessionName = "Imported Session - " + time.Now().Format(time.RFC3339)
	}

	req := &pb.CreateSessionRequest{
		ProjectName:       project.GetName(),
		ProjectPath:       stringPtr(resolvedProjectPath),
		StartTime:         parsed.StartTime,
		EndTime:           optionalString(parsed.EndTime),
		Name:              stringPtr(finalSessionName),
		ToolName:          coalesce(parsed.ToolName, "claude-code"),
		GitBranch:         optionalString(parsed.GitBranch),
		InputTokens:       parsed.TotalInputTokens,
		OutputTokens:      parsed.TotalOutputTokens,
		CacheCreateTokens: parsed.TotalCacheCreateTokens,
		CacheReadTokens:   parsed.TotalCacheReadTokens,
		Interactions:      parsed.Interactions,
		PlanSlug:          optionalString(parsed.PlanSlug),
		Metadata: map[string]string{
			"import_source":       "cli",
			"original_session_id": parsed.SessionID,
		},
	}

	result, err := client.UpsertSession(req, 60*time.Second)
	if err != nil {
		return emitError(err, *jsonOutput)
	}

	_ = saveLastSession(lastSessionInfo{
		SessionID:   result.GetSessionId(),
		ProjectPath: resolvedProjectPath,
		ProjectName: finalProjectName,
		CapturedAt:  time.Now().UTC().Format(time.RFC3339),
	})

	payload := map[string]any{
		"success":               true,
		"sessionId":             result.GetSessionId(),
		"wasUpdated":            result.GetWasUpdated(),
		"newInteractionsCount":  result.GetNewInteractionsCount(),
		"analysisTriggered":     result.GetAnalysisTriggered(),
		"observationsTriggered": result.GetObservationsTriggered(),
		"projectName":           finalProjectName,
		"sessionName":           finalSessionName,
		"transcriptFile":        filepath.Base(resolvedTranscript),
		"totalInputTokens":      parsed.TotalInputTokens,
		"totalOutputTokens":     parsed.TotalOutputTokens,
		"cacheCreateTokens":     parsed.TotalCacheCreateTokens,
		"cacheReadTokens":       parsed.TotalCacheReadTokens,
	}
	return emitJSONOrPretty(payload, *jsonOutput)
}

func runImportAll(args []string) int {
	fs := flag.NewFlagSet("import-all", flag.ContinueOnError)
	projectName := fs.String("project", "", "Project name")
	projectPath := fs.String("path", "", "Project path")
	apiKeyOverride := fs.String("api-key", "", "API key override")
	jsonOutput := fs.Bool("json", false, "Emit JSON output")
	if err := fs.Parse(args); err != nil {
		return 2
	}

	_, client, _, err := initializeAuthenticatedClient(*apiKeyOverride, 15*time.Second)
	if err != nil {
		return emitError(err, *jsonOutput)
	}
	defer client.Close()

	resolvedProjectPath := strings.TrimSpace(*projectPath)
	if resolvedProjectPath == "" {
		if cwd, cwdErr := os.Getwd(); cwdErr == nil {
			resolvedProjectPath = cwd
		}
	}
	if resolvedProjectPath == "" {
		return emitError(errors.New("could not resolve project path"), *jsonOutput)
	}

	resolvedProjectName := strings.TrimSpace(*projectName)
	if resolvedProjectName == "" {
		resolvedProjectName = filepath.Base(resolvedProjectPath)
	}

	files, err := listTranscriptFiles(resolvedProjectPath)
	if err != nil {
		return emitError(err, *jsonOutput)
	}
	if len(files) == 0 {
		return emitError(errors.New("no transcript files found"), *jsonOutput)
	}

	_, err = ensureProject(client, resolvedProjectName, resolvedProjectPath, "")
	if err != nil {
		return emitError(err, *jsonOutput)
	}

	sessionsToImport := len(files)
	wasLimited := false
	skippedCount := 0
	if quota, quotaErr := client.GetSessionQuota(15 * time.Second); quotaErr == nil && quota.GetLimit() != -1 {
		if quota.GetRemaining() <= 0 {
			payload := map[string]any{
				"success":      false,
				"error":        "session_limit_exceeded",
				"message":      fmt.Sprintf("Session limit reached (%d/%d sessions)", quota.GetCurrentCount(), quota.GetLimit()),
				"currentCount": quota.GetCurrentCount(),
				"limit":        quota.GetLimit(),
				"upgradeUrl":   "https://sessionhub.dev/pricing",
				"totalFiles":   len(files),
			}
			return emitJSONOrPretty(payload, true)
		}
		if int(quota.GetRemaining()) < len(files) {
			sessionsToImport = int(quota.GetRemaining())
			wasLimited = true
			skippedCount = len(files) - sessionsToImport
		}
	}

	targetFiles := files[:sessionsToImport]
	results := make([]map[string]any, 0, len(targetFiles))
	successCount := 0
	errorCount := 0

	for _, file := range targetFiles {
		parsed, parseErr := parseTranscriptFile(file, 0)
		if parseErr != nil {
			errorCount++
			results = append(results, map[string]any{"file": filepath.Base(file), "success": false, "error": parseErr.Error()})
			continue
		}

		req := &pb.CreateSessionRequest{
			ProjectName:       resolvedProjectName,
			ProjectPath:       stringPtr(resolvedProjectPath),
			StartTime:         parsed.StartTime,
			EndTime:           optionalString(parsed.EndTime),
			Name:              stringPtr("Imported Session - " + time.Now().Format(time.RFC3339)),
			ToolName:          coalesce(parsed.ToolName, "claude-code"),
			GitBranch:         optionalString(parsed.GitBranch),
			InputTokens:       parsed.TotalInputTokens,
			OutputTokens:      parsed.TotalOutputTokens,
			CacheCreateTokens: parsed.TotalCacheCreateTokens,
			CacheReadTokens:   parsed.TotalCacheReadTokens,
			Interactions:      parsed.Interactions,
			PlanSlug:          optionalString(parsed.PlanSlug),
			Metadata: map[string]string{
				"import_source":       "cli_bulk",
				"original_session_id": parsed.SessionID,
			},
		}

		resp, upsertErr := client.UpsertSession(req, 60*time.Second)
		if upsertErr != nil {
			errorCount++
			results = append(results, map[string]any{"file": filepath.Base(file), "success": false, "error": upsertErr.Error()})
			continue
		}

		successCount++
		results = append(results, map[string]any{"file": filepath.Base(file), "success": true, "sessionId": resp.GetSessionId()})
	}

	payload := map[string]any{
		"success":        errorCount == 0,
		"projectName":    resolvedProjectName,
		"totalFiles":     len(files),
		"processedFiles": len(targetFiles),
		"successCount":   successCount,
		"errorCount":     errorCount,
		"wasLimited":     wasLimited,
		"results":        results,
	}
	if wasLimited {
		payload["limitInfo"] = map[string]any{"skippedCount": skippedCount, "upgradeUrl": "https://sessionhub.dev/pricing"}
	}
	return emitJSONOrPretty(payload, *jsonOutput)
}

func runObservations(args []string) int {
	fs := flag.NewFlagSet("observations", flag.ContinueOnError)
	projectName := fs.String("project", "", "Project name")
	sessionID := fs.String("session-id", "", "Optional session ID filter")
	limit := fs.Int("limit", 50, "Max observations")
	apiKeyOverride := fs.String("api-key", "", "API key override")
	jsonOutput := fs.Bool("json", false, "Emit JSON output")
	if err := fs.Parse(args); err != nil {
		return 2
	}

	_, client, _, err := initializeAuthenticatedClient(*apiKeyOverride, 15*time.Second)
	if err != nil {
		return emitError(err, *jsonOutput)
	}
	defer client.Close()

	resolvedProjectName := strings.TrimSpace(*projectName)
	if resolvedProjectName == "" {
		if last, readErr := loadLastSession(); readErr == nil && strings.TrimSpace(last.ProjectName) != "" {
			resolvedProjectName = last.ProjectName
		}
	}
	if resolvedProjectName == "" {
		if cwd, cwdErr := os.Getwd(); cwdErr == nil {
			resolvedProjectName = filepath.Base(cwd)
		}
	}

	projects, err := client.GetProjects(15 * time.Second)
	if err != nil {
		return emitError(err, *jsonOutput)
	}

	var project *pb.Project
	for _, p := range projects {
		if p.GetName() == resolvedProjectName || p.GetDisplayName() == resolvedProjectName {
			project = p
			break
		}
	}
	if project == nil {
		return emitError(fmt.Errorf("project not found: %s", resolvedProjectName), *jsonOutput)
	}

	resp, err := client.GetProjectObservations(project.GetId(), int32(max(*limit, 1)), 20*time.Second)
	if err != nil {
		return emitError(err, *jsonOutput)
	}

	observations := make([]map[string]any, 0, len(resp.GetObservations()))
	for _, obs := range resp.GetObservations() {
		if strings.TrimSpace(*sessionID) != "" && obs.GetSessionId() != strings.TrimSpace(*sessionID) {
			continue
		}
		observations = append(observations, map[string]any{
			"id":        obs.GetId(),
			"sessionId": obs.GetSessionId(),
			"projectId": obs.GetProjectId(),
			"type":      obs.GetType(),
			"title":     obs.GetTitle(),
			"subtitle":  obs.GetSubtitle(),
			"narrative": obs.GetNarrative(),
			"facts":     obs.GetFacts(),
			"concepts":  obs.GetConcepts(),
			"files":     obs.GetFiles(),
			"toolName":  obs.GetToolName(),
			"createdAt": obs.GetCreatedAt(),
		})
	}

	payload := map[string]any{
		"success":      true,
		"project":      resolvedProjectName,
		"projectId":    project.GetId(),
		"totalCount":   len(observations),
		"observations": observations,
		"webUrl":       "https://sessionhub.dev",
	}
	return emitJSONOrPretty(payload, *jsonOutput)
}

func runSyncSkills(args []string) int {
	fsFlags := flag.NewFlagSet("sync-skills", flag.ContinueOnError)
	teamID := fsFlags.String("team", "", "Team ID")
	projectID := fsFlags.String("project", "", "Project ID filter")
	scope := fsFlags.String("scope", "", "Scope filter: team or project")
	apiKeyOverride := fsFlags.String("api-key", "", "API key override")
	jsonOutput := fsFlags.Bool("json", false, "Emit JSON output")
	if err := fsFlags.Parse(args); err != nil {
		return 2
	}

	_, client, _, err := initializeAuthenticatedClient(*apiKeyOverride, 20*time.Second)
	if err != nil {
		return emitError(err, *jsonOutput)
	}
	defer client.Close()

	resolvedTeamID := strings.TrimSpace(*teamID)
	teamSlug := ""
	if resolvedTeamID == "" {
		teams, teamErr := client.ListUserTeams(20 * time.Second)
		if teamErr != nil {
			return emitError(teamErr, *jsonOutput)
		}
		if len(teams) == 0 {
			return emitError(errors.New("no teams found. Join or create a team first"), *jsonOutput)
		}
		resolvedTeamID = teams[0].GetId()
		teamSlug = teams[0].GetSlug()
	}

	skills, err := client.GetTeamSkills(
		resolvedTeamID,
		optionalString(strings.TrimSpace(*projectID)),
		optionalString(strings.TrimSpace(*scope)),
		20*time.Second,
	)
	if err != nil {
		return emitError(err, *jsonOutput)
	}

	home, _ := os.UserHomeDir()
	skillsDir := filepath.Join(home, ".claude", "skills")
	if err := os.MkdirAll(skillsDir, 0o755); err != nil {
		return emitError(err, *jsonOutput)
	}
	resolvedSkillsDir, _ := filepath.Abs(skillsDir)

	cachePath := filepath.Join(filepath.Dir(configPath()), "skills-cache.json")
	cache := map[string]map[string]any{}
	if data, readErr := os.ReadFile(cachePath); readErr == nil {
		_ = json.Unmarshal(data, &cache)
	}

	teamPrefix := teamSlug
	if teamPrefix == "" {
		if len(resolvedTeamID) > 8 {
			teamPrefix = resolvedTeamID[:8]
		} else {
			teamPrefix = resolvedTeamID
		}
	}

	currentSlugs := map[string]bool{}
	newCount := 0
	updatedCount := 0
	unchangedCount := 0

	for _, skill := range skills {
		effectiveSlug := fmt.Sprintf("%s-%s", teamPrefix, skill.GetSlug())
		skillDir := filepath.Join(skillsDir, effectiveSlug)
		resolvedDir, _ := filepath.Abs(skillDir)
		if !strings.HasPrefix(resolvedDir, resolvedSkillsDir+string(os.PathSeparator)) {
			continue
		}
		currentSlugs[effectiveSlug] = true

		if cached, ok := cache[effectiveSlug]; ok {
			if toInt64(cached["version"]) == int64(skill.GetVersion()) {
				unchangedCount++
				continue
			}
		}

		if err := os.MkdirAll(skillDir, 0o755); err != nil {
			continue
		}

		desc := strings.ReplaceAll(skill.GetSummary(), "\n", " ")
		if strings.TrimSpace(desc) == "" {
			desc = strings.ReplaceAll(skill.GetTitle(), "\n", " ")
		}
		desc = strings.ReplaceAll(desc, "\"", "\\\"")
		frontmatter := fmt.Sprintf("---\nname: %s\ndescription: \"%s\"\n---\n\n", effectiveSlug, desc)

		files := skill.GetFiles()
		if len(files) > 1 {
			for relPath, content := range files {
				if strings.Contains(relPath, "..") || strings.HasPrefix(relPath, "/") {
					continue
				}
				fullPath := filepath.Join(skillDir, relPath)
				absPath, _ := filepath.Abs(fullPath)
				if !strings.HasPrefix(absPath, resolvedDir+string(os.PathSeparator)) {
					continue
				}
				if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
					continue
				}
				isEntry := relPath == "SKILL.md" || relPath == "index.md" || relPath == "README.md"
				out := content
				if isEntry {
					out = frontmatter + out
				}
				_ = os.WriteFile(fullPath, []byte(out), 0o644)
			}
		} else {
			out := frontmatter + skill.GetContent()
			_ = os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(out), 0o644)
		}

		if _, ok := cache[effectiveSlug]; ok {
			updatedCount++
		} else {
			newCount++
		}
		cache[effectiveSlug] = map[string]any{"version": skill.GetVersion(), "slug": skill.GetSlug()}
	}

	removedCount := 0
	for slug := range cache {
		if currentSlugs[slug] {
			continue
		}
		skillDir := filepath.Join(skillsDir, slug)
		resolvedDir, _ := filepath.Abs(skillDir)
		if strings.HasPrefix(resolvedDir, resolvedSkillsDir+string(os.PathSeparator)) {
			_ = os.RemoveAll(skillDir)
		}
		delete(cache, slug)
		removedCount++
	}

	if err := os.MkdirAll(filepath.Dir(cachePath), 0o700); err == nil {
		if payload, marshalErr := json.MarshalIndent(cache, "", "  "); marshalErr == nil {
			_ = os.WriteFile(cachePath, payload, 0o600)
		}
	}

	payload := map[string]any{
		"success":      true,
		"teamId":       resolvedTeamID,
		"skillsSynced": len(skills),
		"new":          newCount,
		"updated":      updatedCount,
		"unchanged":    unchangedCount,
		"removed":      removedCount,
		"skillsDir":    skillsDir,
	}
	if len(skills) == 0 {
		payload["message"] = fmt.Sprintf("No approved team skills found; removed %d previously synced skills", removedCount)
	} else {
		payload["message"] = fmt.Sprintf("Synced %d skills (%d new, %d updated, %d removed)", len(skills), newCount, updatedCount, removedCount)
	}
	return emitJSONOrPretty(payload, *jsonOutput)
}

func runPushSkill(args []string) int {
	fsFlags := flag.NewFlagSet("push-skill", flag.ContinueOnError)
	teamID := fsFlags.String("team", "", "Team ID")
	filePath := fsFlags.String("file", "", "Path to skill .md file")
	dirPath := fsFlags.String("dir", "", "Path to skill directory")
	title := fsFlags.String("title", "", "Skill title")
	category := fsFlags.String("category", "", "Skill category")
	tagsCSV := fsFlags.String("tags", "", "Comma-separated tags")
	summary := fsFlags.String("summary", "", "Short summary")
	apiKeyOverride := fsFlags.String("api-key", "", "API key override")
	jsonOutput := fsFlags.Bool("json", false, "Emit JSON output")
	if err := fsFlags.Parse(args); err != nil {
		return 2
	}

	if strings.TrimSpace(*filePath) == "" && strings.TrimSpace(*dirPath) == "" {
		return emitError(errors.New("--file or --dir is required"), *jsonOutput)
	}
	if strings.TrimSpace(*filePath) != "" && strings.TrimSpace(*dirPath) != "" {
		return emitError(errors.New("use either --file or --dir, not both"), *jsonOutput)
	}

	_, client, _, err := initializeAuthenticatedClient(*apiKeyOverride, 20*time.Second)
	if err != nil {
		return emitError(err, *jsonOutput)
	}
	defer client.Close()

	filesMap := map[string]string{}
	resolvedTitle := strings.TrimSpace(*title)
	resolvedSummary := strings.TrimSpace(*summary)
	skillContent := ""

	if strings.TrimSpace(*dirPath) != "" {
		base := strings.TrimSpace(*dirPath)
		info, statErr := os.Stat(base)
		if statErr != nil || !info.IsDir() {
			return emitError(fmt.Errorf("directory not found: %s", base), *jsonOutput)
		}

		_ = filepath.WalkDir(base, func(path string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil || d.IsDir() {
				return nil
			}
			rel, relErr := filepath.Rel(base, path)
			if relErr != nil || strings.Contains(rel, "..") {
				return nil
			}
			b, readErr := os.ReadFile(path)
			if readErr == nil {
				filesMap[filepath.ToSlash(rel)] = string(b)
			}
			return nil
		})
		if len(filesMap) == 0 {
			return emitError(fmt.Errorf("no files found in %s", base), *jsonOutput)
		}

		entry := ""
		for _, candidate := range []string{"SKILL.md", "index.md", "README.md"} {
			if v, ok := filesMap[candidate]; ok {
				entry = v
				break
			}
		}
		if entry == "" {
			for k, v := range filesMap {
				if strings.HasSuffix(strings.ToLower(k), ".md") {
					entry = v
					break
				}
			}
		}
		if entry != "" {
			content, fmTitle, fmSummary := parseFrontmatter(entry)
			skillContent = content
			if resolvedTitle == "" && fmTitle != "" {
				resolvedTitle = fmTitle
			}
			if resolvedSummary == "" && fmSummary != "" {
				resolvedSummary = fmSummary
			}
		}
		if resolvedTitle == "" {
			resolvedTitle = titleCase(filepath.Base(base))
		}
	} else {
		path := strings.TrimSpace(*filePath)
		b, readErr := os.ReadFile(path)
		if readErr != nil {
			return emitError(fmt.Errorf("could not read file %s: %w", path, readErr), *jsonOutput)
		}
		content := string(b)
		var fmTitle, fmSummary string
		skillContent, fmTitle, fmSummary = parseFrontmatter(content)
		if resolvedTitle == "" && fmTitle != "" {
			resolvedTitle = fmTitle
		}
		if resolvedSummary == "" && fmSummary != "" {
			resolvedSummary = fmSummary
		}
		if resolvedTitle == "" {
			resolvedTitle = titleCase(strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)))
		}
		filesMap["SKILL.md"] = content
	}

	resolvedTeamID := strings.TrimSpace(*teamID)
	if resolvedTeamID == "" {
		teams, teamErr := client.ListUserTeams(20 * time.Second)
		if teamErr != nil {
			return emitError(teamErr, *jsonOutput)
		}
		if len(teams) == 0 {
			return emitError(errors.New("no teams found. Join or create a team first"), *jsonOutput)
		}
		resolvedTeamID = teams[0].GetId()
	}

	tags := []string{}
	for _, t := range strings.Split(strings.TrimSpace(*tagsCSV), ",") {
		tt := strings.ToLower(strings.TrimSpace(t))
		if tt != "" {
			tags = append(tags, tt)
		}
	}

	req := &pb.CreateTeamSkillRequest{
		TeamId:   resolvedTeamID,
		Title:    resolvedTitle,
		Content:  skillContent,
		Summary:  optionalString(resolvedSummary),
		Category: optionalString(strings.TrimSpace(*category)),
		Tags:     tags,
		Files:    filesMap,
	}

	resp, err := client.CreateTeamSkill(req, 20*time.Second)
	if err != nil {
		return emitError(err, *jsonOutput)
	}

	fileCount := len(filesMap)
	payload := map[string]any{
		"success":   true,
		"skillId":   resp.GetSkillId(),
		"slug":      resp.GetSlug(),
		"title":     resolvedTitle,
		"teamId":    resolvedTeamID,
		"fileCount": fileCount,
		"message":   fmt.Sprintf("Created draft skill \"%s\" (%d file%s) — submit for review in the web UI", resp.GetSlug(), fileCount, plural(fileCount)),
	}
	return emitJSONOrPretty(payload, *jsonOutput)
}

func runHook(args []string) int {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "usage: sessionhub hook session-start")
		return 2
	}

	switch args[0] {
	case "session-start":
		return runHookSessionStart()
	case "session-start-context":
		return emitEmptySessionStartContext()
	case "session-start-clear-capture":
		return emitEmptySessionStartContext()
	case "session-end":
		return 0
	default:
		fmt.Fprintf(os.Stderr, "unknown hook subcommand: %s\n", args[0])
		return 2
	}
}

func runHookSessionStart() int {
	input := readHookInput()
	cfg, _ := loadConfig()
	configured := strings.TrimSpace(cfg.User.APIKey) != ""

	projectDir := strings.TrimSpace(os.Getenv("CLAUDE_PROJECT_DIR"))
	if projectDir == "" {
		projectDir = strings.TrimSpace(input.Cwd)
	}
	if projectDir == "" {
		if cwd, err := os.Getwd(); err == nil {
			projectDir = cwd
		}
	}

	appendProjectDirToEnv(projectDir)

	contextParts := make([]string, 0, 2)
	if !configured {
		contextParts = append(contextParts,
			"**SessionHub Setup Required**: Run `/setup <your-api-key>` to enable session capture. Get your API key at https://sessionhub.dev/settings",
		)
	}

	if uuidPattern.MatchString(strings.TrimSpace(input.SessionID)) {
		contextParts = append(contextParts,
			fmt.Sprintf("[SESSIONHUB_SESSION_ID:%s] [SESSIONHUB_PROJECT_DIR:%s]", input.SessionID, projectDir),
		)
	}

	if len(contextParts) == 0 {
		return 0
	}

	output := hookOutput{}
	output.HookSpecificOutput.HookEventName = "SessionStart"
	output.HookSpecificOutput.AdditionalContext = strings.Join(contextParts, " | ")
	_ = json.NewEncoder(os.Stdout).Encode(output)
	return 0
}

func emitEmptySessionStartContext() int {
	output := hookOutput{}
	output.HookSpecificOutput.HookEventName = "SessionStart"
	output.HookSpecificOutput.AdditionalContext = ""
	_ = json.NewEncoder(os.Stdout).Encode(output)
	return 0
}

func parseTranscriptFile(filePath string, lastExchanges int) (*parsedSession, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("read transcript: %w", err)
	}
	lines := strings.Split(string(data), "\n")

	parsed := &parsedSession{ToolName: "claude-code"}
	interactions := make([]*pb.InteractionData, 0, 512)
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		var entry map[string]any
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			continue
		}

		ts := asString(entry["timestamp"])
		if parsed.StartTime == "" && ts != "" {
			parsed.StartTime = ts
		}
		if ts != "" {
			parsed.EndTime = ts
		}
		if parsed.SessionID == "" {
			parsed.SessionID = asString(entry["sessionId"])
		}
		if parsed.Cwd == "" {
			parsed.Cwd = asString(entry["cwd"])
		}
		if parsed.GitBranch == "" {
			parsed.GitBranch = asString(entry["gitBranch"])
		}
		if slug := asString(entry["slug"]); slug != "" && parsed.PlanSlug == "" {
			parsed.PlanSlug = slug
		}

		typeName := strings.ToLower(asString(entry["type"]))
		msg := asMap(entry["message"])
		role := strings.ToLower(asString(msg["role"]))
		content := msg["content"]

		if (typeName == "user" || typeName == "human") && role == "user" {
			prompt := extractUserText(content)
			if prompt != "" && !isSystemMessage(prompt) {
				interactions = append(interactions, &pb.InteractionData{
					Timestamp:       ts,
					InteractionType: "prompt",
					Content:         prompt,
					Metadata:        map[string]string{},
				})
			}
		}

		if typeName == "assistant" && role == "assistant" {
			response := extractAssistantText(content)
			usage := asMap(msg["usage"])
			inTok := toInt64(usage["input_tokens"])
			outTok := toInt64(usage["output_tokens"])
			cacheCreate := toInt64(usage["cache_creation_input_tokens"])
			cacheRead := toInt64(usage["cache_read_input_tokens"])
			parsed.TotalInputTokens += inTok
			parsed.TotalOutputTokens += outTok
			parsed.TotalCacheCreateTokens += cacheCreate
			parsed.TotalCacheReadTokens += cacheRead

			if response != "" {
				interactions = append(interactions, &pb.InteractionData{
					Timestamp:       ts,
					InteractionType: "response",
					Content:         response,
					Metadata:        map[string]string{},
					InputTokens:     int64Ptr(inTok),
					OutputTokens:    int64Ptr(outTok),
				})
			}

			for _, tool := range extractToolUses(content) {
				toolCopy := tool
				interactions = append(interactions, &pb.InteractionData{
					Timestamp:       ts,
					InteractionType: "tool_call",
					Content:         "Tool: " + tool,
					ToolName:        &toolCopy,
					Metadata:        map[string]string{"hook_event": "PreToolUse"},
				})
			}
		}
	}

	if parsed.StartTime == "" {
		return nil, errors.New("transcript has no timestamped content")
	}
	if parsed.SessionID == "" {
		parsed.SessionID = strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath))
	}

	parsed.Interactions = applyLastExchangeFilter(interactions, lastExchanges)
	parsed.TotalInputTokens, parsed.TotalOutputTokens = recomputeTokens(parsed.Interactions, parsed.TotalInputTokens, parsed.TotalOutputTokens)
	return parsed, nil
}

func applyLastExchangeFilter(interactions []*pb.InteractionData, lastExchanges int) []*pb.InteractionData {
	if lastExchanges <= 0 {
		return interactions
	}
	promptIndexes := make([]int, 0)
	for i, it := range interactions {
		if it.GetInteractionType() == "prompt" {
			promptIndexes = append(promptIndexes, i)
		}
	}
	if len(promptIndexes) == 0 || lastExchanges >= len(promptIndexes) {
		return interactions
	}
	start := promptIndexes[len(promptIndexes)-lastExchanges]
	return interactions[start:]
}

func recomputeTokens(interactions []*pb.InteractionData, fallbackIn, fallbackOut int64) (int64, int64) {
	var inTok, outTok int64
	for _, it := range interactions {
		inTok += it.GetInputTokens()
		outTok += it.GetOutputTokens()
	}
	if inTok == 0 && outTok == 0 {
		return fallbackIn, fallbackOut
	}
	return inTok, outTok
}

func extractUserText(content any) string {
	switch v := content.(type) {
	case string:
		return strings.TrimSpace(v)
	case []any:
		parts := make([]string, 0, len(v))
		for _, item := range v {
			m := asMap(item)
			if strings.ToLower(asString(m["type"])) == "text" {
				text := strings.TrimSpace(asString(m["text"]))
				if text != "" {
					parts = append(parts, text)
				}
			}
		}
		return strings.TrimSpace(strings.Join(parts, "\n"))
	default:
		return ""
	}
}

func extractAssistantText(content any) string {
	switch v := content.(type) {
	case string:
		return strings.TrimSpace(v)
	case []any:
		parts := make([]string, 0, len(v))
		for _, item := range v {
			m := asMap(item)
			if strings.ToLower(asString(m["type"])) == "text" {
				text := strings.TrimSpace(asString(m["text"]))
				if text != "" {
					parts = append(parts, text)
				}
			}
		}
		return strings.TrimSpace(strings.Join(parts, "\n"))
	default:
		return ""
	}
}

func extractToolUses(content any) []string {
	arr, ok := content.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0)
	for _, item := range arr {
		m := asMap(item)
		if strings.ToLower(asString(m["type"])) == "tool_use" {
			name := strings.TrimSpace(asString(m["name"]))
			if name != "" && name != "TodoWrite" && name != "ExitPlanMode" {
				out = append(out, name)
			}
		}
	}
	return out
}

func isSystemMessage(text string) bool {
	t := strings.TrimSpace(text)
	if t == "" {
		return true
	}
	return strings.HasPrefix(t, "<command-name>") ||
		strings.Contains(t, "<local-command-stdout>") ||
		strings.Contains(t, "<local-command-stderr>") ||
		strings.Contains(t, "<system-reminder>") ||
		strings.Contains(t, "Error opening memory file") ||
		strings.Contains(t, "Cancelled memory editing")
}

func findLatestTranscriptFile(projectPath, sessionID string) (string, error) {
	files, err := listTranscriptFiles(projectPath)
	if err != nil {
		return "", err
	}
	if len(files) == 0 {
		return "", nil
	}

	if strings.TrimSpace(sessionID) != "" {
		for _, f := range files {
			extracted, _ := quickExtractSessionID(f)
			if extracted == sessionID {
				info, statErr := os.Stat(f)
				if statErr == nil && info.Size() >= 10000 {
					return f, nil
				}
				break
			}
		}
	}

	type candidate struct {
		path string
		mt   time.Time
	}
	all := make([]candidate, 0, len(files))
	for _, f := range files {
		st, statErr := os.Stat(f)
		if statErr != nil {
			continue
		}
		all = append(all, candidate{path: f, mt: st.ModTime()})
	}
	if len(all) == 0 {
		return "", nil
	}
	sort.Slice(all, func(i, j int) bool { return all[i].mt.After(all[j].mt) })
	return all[0].path, nil
}

func listTranscriptFiles(projectPath string) ([]string, error) {
	dir := claudeProjectDir(projectPath)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []string{}, nil
		}
		return nil, err
	}
	files := make([]string, 0)
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".jsonl") || strings.HasPrefix(name, "agent-") {
			continue
		}
		files = append(files, filepath.Join(dir, name))
	}
	sort.Strings(files)
	return files, nil
}

func claudeProjectDir(projectPath string) string {
	home, _ := os.UserHomeDir()
	replacer := strings.NewReplacer("/", "-", "\\", "-", "_", "-")
	dirName := replacer.Replace(projectPath)
	return filepath.Join(home, ".claude", "projects", dirName)
}

func quickExtractSessionID(filePath string) (string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer f.Close()
	buf := make([]byte, 64*1024)
	n, _ := f.Read(buf)
	if n <= 0 {
		return "", nil
	}
	m := sessionIDPattern.FindStringSubmatch(string(buf[:n]))
	if len(m) > 1 {
		return m[1], nil
	}
	return "", nil
}

func ensureProject(client *apiClient, projectName, projectPath, gitBranch string) (*pb.Project, error) {
	projects, err := client.GetProjects(20 * time.Second)
	if err != nil {
		return nil, err
	}
	for _, p := range projects {
		if p.GetName() == projectName || p.GetDisplayName() == projectName {
			return p, nil
		}
	}

	desc := fmt.Sprintf("Auto-created project from CLI for %s", projectName)
	gitRemote := detectGitRemote(projectPath)
	proj, err := client.CreateProject(&pb.CreateProjectRequest{
		Name:        projectName,
		DisplayName: projectName,
		Description: &desc,
		GitRemote:   optionalString(gitRemote),
		Metadata:    map[string]string{},
	})
	if err != nil {
		return nil, err
	}
	return proj, nil
}

func detectGitRemote(projectPath string) string {
	cmd := exec.Command("git", "-C", projectPath, "config", "--get", "remote.origin.url")
	output, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

func initializeAuthenticatedClient(apiKeyOverride string, timeout time.Duration) (config, *apiClient, *pb.ValidateApiKeyResponse, error) {
	cfg, err := loadConfig()
	if err != nil {
		return cfg, nil, nil, fmt.Errorf("failed to load config: %w", err)
	}

	apiKey := strings.TrimSpace(apiKeyOverride)
	if apiKey == "" {
		apiKey = strings.TrimSpace(cfg.User.APIKey)
	}
	if apiKey == "" {
		return cfg, nil, nil, errors.New("SessionHub is not configured. Run /setup <your-api-key>")
	}

	client, err := newAPIClient(cfg, apiKey, timeout)
	if err != nil {
		return cfg, nil, nil, err
	}

	user, err := client.ValidateAPIKey(timeout)
	if err != nil {
		client.Close()
		return cfg, nil, nil, err
	}
	if user == nil {
		client.Close()
		return cfg, nil, nil, errors.New("invalid API key")
	}
	return cfg, client, user, nil
}

func newAPIClient(cfg config, apiKey string, timeout time.Duration) (*apiClient, error) {
	addr := withDefaultPort(cfg.BackendGRPCURL)
	if strings.TrimSpace(addr) == "" {
		addr = "plugin.sessionhub.dev:443"
	}
	useTLS := resolveTLS(addr, cfg.GRPCUseTLS)

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	var creds grpc.DialOption
	if useTLS {
		creds = grpc.WithTransportCredentials(credentials.NewTLS(&tls.Config{MinVersion: tls.VersionTLS12}))
	} else {
		creds = grpc.WithTransportCredentials(insecure.NewCredentials())
	}

	conn, err := grpc.DialContext(ctx, addr, creds, grpc.WithBlock())
	if err != nil {
		return nil, err
	}

	return &apiClient{conn: conn, client: pb.NewSessionHubServiceClient(conn), apiKey: apiKey}, nil
}

func (c *apiClient) Close() {
	if c.conn != nil {
		_ = c.conn.Close()
	}
}

func (c *apiClient) authContext(timeout time.Duration) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	if strings.TrimSpace(c.apiKey) == "" {
		return ctx, cancel
	}
	md := metadata.Pairs("authorization", "Bearer "+c.apiKey)
	return metadata.NewOutgoingContext(ctx, md), cancel
}

func (c *apiClient) ValidateAPIKey(timeout time.Duration) (*pb.ValidateApiKeyResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	resp, err := c.client.ValidateApiKey(ctx, &pb.ValidateApiKeyRequest{ApiKey: c.apiKey})
	if err != nil {
		st, ok := status.FromError(err)
		if ok && (st.Code() == codes.Unauthenticated || st.Code() == codes.NotFound) {
			return nil, nil
		}
		return nil, err
	}
	return resp, nil
}

func (c *apiClient) GetProjects(timeout time.Duration) ([]*pb.Project, error) {
	ctx, cancel := c.authContext(timeout)
	defer cancel()
	resp, err := c.client.GetProjects(ctx, &pb.GetProjectsRequest{})
	if err != nil {
		return nil, err
	}
	return resp.GetProjects(), nil
}

func (c *apiClient) CreateProject(req *pb.CreateProjectRequest) (*pb.Project, error) {
	ctx, cancel := c.authContext(20 * time.Second)
	defer cancel()
	return c.client.CreateProject(ctx, req)
}

func (c *apiClient) UpsertSession(req *pb.CreateSessionRequest, timeout time.Duration) (*pb.UpsertSessionResponse, error) {
	ctx, cancel := c.authContext(timeout)
	defer cancel()
	return c.client.UpsertSession(ctx, req)
}

func (c *apiClient) GetProjectObservations(projectID string, limit int32, timeout time.Duration) (*pb.GetProjectObservationsResponse, error) {
	ctx, cancel := c.authContext(timeout)
	defer cancel()
	return c.client.GetProjectObservations(ctx, &pb.GetProjectObservationsRequest{ProjectId: projectID, Limit: &limit})
}

func (c *apiClient) GetSessionQuota(timeout time.Duration) (*pb.GetSessionQuotaResponse, error) {
	ctx, cancel := c.authContext(timeout)
	defer cancel()
	return c.client.GetSessionQuota(ctx, &pb.GetSessionQuotaRequest{})
}

func (c *apiClient) ListUserTeams(timeout time.Duration) ([]*pb.Team, error) {
	ctx, cancel := c.authContext(timeout)
	defer cancel()
	resp, err := c.client.ListUserTeams(ctx, &pb.ListUserTeamsRequest{})
	if err != nil {
		return nil, err
	}
	return resp.GetTeams(), nil
}

func (c *apiClient) GetTeamSkills(teamID string, projectID *string, scope *string, timeout time.Duration) ([]*pb.TeamSkillProto, error) {
	ctx, cancel := c.authContext(timeout)
	defer cancel()
	req := &pb.GetTeamSkillsRequest{TeamId: teamID}
	if projectID != nil {
		req.ProjectId = projectID
	}
	if scope != nil {
		req.Scope = scope
	}
	resp, err := c.client.GetTeamSkills(ctx, req)
	if err != nil {
		return nil, err
	}
	return resp.GetSkills(), nil
}

func (c *apiClient) CreateTeamSkill(req *pb.CreateTeamSkillRequest, timeout time.Duration) (*pb.CreateTeamSkillResponse, error) {
	ctx, cancel := c.authContext(timeout)
	defer cancel()
	return c.client.CreateTeamSkill(ctx, req)
}

func readHookInput() hookInput {
	stdinInfo, err := os.Stdin.Stat()
	if err != nil {
		return hookInput{}
	}
	if (stdinInfo.Mode() & os.ModeCharDevice) != 0 {
		return hookInput{}
	}

	body, err := io.ReadAll(bufio.NewReader(os.Stdin))
	if err != nil || len(strings.TrimSpace(string(body))) == 0 {
		return hookInput{}
	}

	var input hookInput
	if err := json.Unmarshal(body, &input); err != nil {
		return hookInput{}
	}
	return input
}

func appendProjectDirToEnv(projectDir string) {
	envFile := strings.TrimSpace(os.Getenv("CLAUDE_ENV_FILE"))
	if envFile == "" || projectDir == "" {
		return
	}

	f, err := os.OpenFile(envFile, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0o600)
	if err != nil {
		return
	}
	defer f.Close()

	escaped := escapeShellString(projectDir)
	_, _ = f.WriteString(fmt.Sprintf("export SESSIONHUB_PROJECT_DIR=\"%s\"\n", escaped))
}

func escapeShellString(v string) string {
	clean := strings.NewReplacer("\n", "", "\r", "").Replace(v)
	replacer := strings.NewReplacer(
		`\\`, `\\\\`,
		`"`, `\\"`,
		"$", `\\$`,
		"`", "\\`",
	)
	return replacer.Replace(clean)
}

func configPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".sessionhub/config.json"
	}
	return filepath.Join(home, ".sessionhub", "config.json")
}

func lastSessionPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".sessionhub/last-session.json"
	}
	return filepath.Join(home, ".sessionhub", "last-session.json")
}

func loadConfig() (config, error) {
	var cfg config
	cfg.BackendGRPCURL = "plugin.sessionhub.dev"

	path := configPath()
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return cfg, nil
		}
		return cfg, err
	}

	if err := json.Unmarshal(data, &cfg); err != nil {
		return cfg, err
	}
	if strings.TrimSpace(cfg.BackendGRPCURL) == "" {
		cfg.BackendGRPCURL = "plugin.sessionhub.dev"
	}
	return cfg, nil
}

func saveConfig(cfg config) error {
	path := configPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, payload, 0o600)
}

func saveLastSession(info lastSessionInfo) error {
	path := lastSessionPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return err
	}
	tmp := fmt.Sprintf("%s.%d.tmp", path, os.Getpid())
	if err := os.WriteFile(tmp, payload, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func loadLastSession() (lastSessionInfo, error) {
	var info lastSessionInfo
	data, err := os.ReadFile(lastSessionPath())
	if err != nil {
		return info, err
	}
	err = json.Unmarshal(data, &info)
	return info, err
}

func withDefaultPort(host string) string {
	trimmed := strings.TrimSpace(host)
	if trimmed == "" {
		return "plugin.sessionhub.dev:443"
	}
	if _, _, err := net.SplitHostPort(trimmed); err == nil {
		return trimmed
	}
	if strings.Contains(trimmed, ":") {
		return trimmed
	}
	if isLocalHost(trimmed) {
		return trimmed + ":50051"
	}
	return trimmed + ":443"
}

func resolveTLS(addr string, override *bool) bool {
	if override != nil {
		return *override
	}
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		host = addr
	}
	return !isLocalHost(host)
}

func isLocalHost(host string) bool {
	h := strings.Trim(strings.ToLower(host), "[]")
	return h == "localhost" || h == "127.0.0.1" || h == "::1"
}

func emitSetupError(jsonOutput bool, msg string) {
	if jsonOutput {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"success": false, "error": msg})
		return
	}
	fmt.Fprintln(os.Stderr, msg)
}

func emitHealth(result healthResult, jsonOutput bool) int {
	if jsonOutput {
		_ = json.NewEncoder(os.Stdout).Encode(result)
	} else {
		statusText := "ok"
		if !result.OK {
			statusText = "error"
		}
		fmt.Printf("SessionHub health: %s\n", statusText)
		fmt.Printf("Backend: %s (tls=%t)\n", result.Backend, result.TLS)
		fmt.Printf("Reachable: %t, latency=%dms\n", result.BackendReachable, result.LatencyMS)
		if result.Configured {
			fmt.Printf("Authenticated: %t\n", result.Authenticated)
			if result.UserEmail != "" {
				fmt.Printf("User: %s\n", result.UserEmail)
			}
		} else {
			fmt.Println("Authenticated: false (no API key configured)")
		}
		if result.Error != "" {
			fmt.Fprintf(os.Stderr, "Error: %s\n", result.Error)
		}
	}
	if result.OK {
		return 0
	}
	return 1
}

func emitError(err error, jsonOutput bool) int {
	if jsonOutput {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"success": false, "error": err.Error()})
		return 1
	}
	fmt.Fprintln(os.Stderr, "Error:", err.Error())
	return 1
}

func emitJSONOrPretty(payload map[string]any, jsonOutput bool) int {
	if jsonOutput {
		_ = json.NewEncoder(os.Stdout).Encode(payload)
		return 0
	}
	pretty, _ := json.MarshalIndent(payload, "", "  ")
	fmt.Println(string(pretty))
	return 0
}

func asMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func asString(v any) string {
	s, _ := v.(string)
	return strings.TrimSpace(s)
}

func toInt64(v any) int64 {
	switch x := v.(type) {
	case float64:
		return int64(x)
	case float32:
		return int64(x)
	case int:
		return int64(x)
	case int32:
		return int64(x)
	case int64:
		return x
	case json.Number:
		i, _ := x.Int64()
		return i
	default:
		return 0
	}
}

func stringPtr(v string) *string {
	return &v
}

func optionalString(v string) *string {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	return &v
}

func int64Ptr(v int64) *int64 {
	return &v
}

func coalesce(v, fallback string) string {
	if strings.TrimSpace(v) == "" {
		return fallback
	}
	return v
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func parseFrontmatter(content string) (body, name, description string) {
	m := frontmatterRegex.FindStringSubmatch(content)
	if len(m) != 3 {
		return strings.TrimSpace(content), "", ""
	}
	fm := m[1]
	body = strings.TrimSpace(m[2])
	if mm := fmNameRegex.FindStringSubmatch(fm); len(mm) > 1 {
		name = strings.TrimSpace(mm[1])
	}
	if mm := fmDescRegex.FindStringSubmatch(fm); len(mm) > 1 {
		description = strings.Trim(strings.TrimSpace(mm[1]), `"'`)
	}
	return body, name, description
}

func titleCase(input string) string {
	input = strings.ReplaceAll(input, "-", " ")
	input = strings.ReplaceAll(input, "_", " ")
	parts := strings.Fields(strings.ToLower(input))
	for i := range parts {
		if len(parts[i]) > 0 {
			parts[i] = strings.ToUpper(parts[i][:1]) + parts[i][1:]
		}
	}
	return strings.Join(parts, " ")
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}
