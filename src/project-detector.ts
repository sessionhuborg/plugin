/**
 * Project detection functionality.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, basename, dirname } from 'path';
import { execSync } from 'child_process';
import { ProjectData } from './models.js';

export class ProjectDetector {
  detectProject(currentPath: string): ProjectData | null {
    const projectRoot = this.findProjectRoot(currentPath);
    if (!projectRoot) {
      return null;
    }

    const projectName = this.extractProjectName(projectRoot);
    const gitRemote = this.getGitRemote(projectRoot) || undefined;
    const branch = this.getGitBranch(projectRoot) || undefined;

    return {
      path: projectRoot,
      name: projectName,
      gitRemote,
      branch,
    };
  }

  private findProjectRoot(startPath: string): string | null {
    let current = resolve(startPath);

    const indicators = [
      '.git',
      'package.json',
      'pyproject.toml',
      'setup.py',
      'Cargo.toml',
      'go.mod',
      'pom.xml',
      'build.gradle',
      'CMakeLists.txt',
      'Makefile',
      '.project',
      'composer.json',
      'requirements.txt',
      'environment.yml',
      'Pipfile',
    ];

    const paths = [current];
    let parent = dirname(current);
    while (parent !== current) {
      paths.push(parent);
      current = parent;
      parent = dirname(current);
    }

    for (const path of paths) {
      for (const indicator of indicators) {
        if (existsSync(resolve(path, indicator))) {
          return path;
        }
      }
    }

    return startPath;
  }

  private extractProjectName(projectRoot: string): string {
    const packageJsonPath = resolve(projectRoot, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        if (packageJson.name) {
          return packageJson.name;
        }
      } catch (error) {
        // Ignore
      }
    }

    const pyprojectPath = resolve(projectRoot, 'pyproject.toml');
    if (existsSync(pyprojectPath)) {
      try {
        const content = readFileSync(pyprojectPath, 'utf8');
        const nameMatch = content.match(/name\s*=\s*["']([^"']+)["']/);
        if (nameMatch) {
          return nameMatch[1];
        }
      } catch (error) {
        // Ignore
      }
    }

    const cargoTomlPath = resolve(projectRoot, 'Cargo.toml');
    if (existsSync(cargoTomlPath)) {
      try {
        const content = readFileSync(cargoTomlPath, 'utf8');
        const nameMatch = content.match(/name\s*=\s*["']([^"']+)["']/);
        if (nameMatch) {
          return nameMatch[1];
        }
      } catch (error) {
        // Ignore
      }
    }

    const goModPath = resolve(projectRoot, 'go.mod');
    if (existsSync(goModPath)) {
      try {
        const content = readFileSync(goModPath, 'utf8');
        const lines = content.split('\n');
        const firstLine = lines[0].trim();
        if (firstLine.startsWith('module ')) {
          const moduleName = firstLine.substring(7).trim();
          return moduleName.split('/').pop() || moduleName;
        }
      } catch (error) {
        // Ignore
      }
    }

    const gitName = this.extractNameFromGit(projectRoot);
    if (gitName) {
      return gitName;
    }

    return basename(projectRoot);
  }

  private getGitRemote(projectRoot: string): string | null {
    try {
      const result = execSync('git remote get-url origin', {
        cwd: projectRoot,
        encoding: 'utf8',
        timeout: 5000,
        stdio: 'pipe',
      });
      return result.trim();
    } catch (error) {
      return null;
    }
  }

  private getGitBranch(projectRoot: string): string | null {
    try {
      const result = execSync('git branch --show-current', {
        cwd: projectRoot,
        encoding: 'utf8',
        timeout: 5000,
        stdio: 'pipe',
      });
      return result.trim();
    } catch (error) {
      return null;
    }
  }

  private extractNameFromGit(projectRoot: string): string | null {
    const remote = this.getGitRemote(projectRoot);
    if (!remote) {
      return null;
    }

    let repoName = remote;

    if (repoName.endsWith('.git')) {
      repoName = repoName.slice(0, -4);
    }

    if (repoName.includes('/')) {
      return repoName.split('/').pop() || null;
    }

    return null;
  }
}
