import { describe, expect, it } from 'vitest';
import {
  cachePath,
  getDefaultStateDir,
  getKnownStateDirs,
  getStateDir,
  lockPathForStateDir,
  lockPath,
  metricsPath,
  sessionPath,
  socketDirectoryForStateDir,
  socketPathForStateDir,
  socketPath,
  statePath,
} from './state-paths.js';

describe('getStateDir', () => {
  it('owns default, XDG and state-root path construction centrally', () => {
    const options = {
      env: {
        GLMCP_STATE_DIR: '/srv/glmcp/custom',
        XDG_STATE_HOME: '/srv/xdg',
      },
      platform: 'linux' as const,
      homeDir: '/home/tester',
      currentDir: '/work/repository',
    };
    expect(getDefaultStateDir(options)).toBe(
      '/home/tester/.local/share/german-legal-mcp',
    );
    expect(getKnownStateDirs(options)).toEqual([
      '/home/tester/.local/share/german-legal-mcp',
      '/srv/glmcp/custom',
      '/srv/xdg/german-legal-mcp',
    ]);
    expect(socketDirectoryForStateDir('/srv/glmcp/custom')).toBe(
      '/srv/glmcp/custom/sockets',
    );
    expect(socketPathForStateDir('/srv/glmcp/custom', 'daemon.sock')).toBe(
      '/srv/glmcp/custom/sockets/daemon.sock',
    );
    expect(lockPathForStateDir('/srv/glmcp/custom', 'start.lock')).toBe(
      '/srv/glmcp/custom/locks/start.lock',
    );
  });

  it('prefers an explicit absolute state directory', () => {
    expect(getStateDir({
      env: { GLMCP_STATE_DIR: '/srv/glmcp' },
      platform: 'linux',
      homeDir: '/home/test',
    })).toBe('/srv/glmcp');
  });

  it('rejects broad configured roots before any filesystem mutation', () => {
    const options = {
      platform: 'linux' as const,
      homeDir: '/home/test',
      currentDir: '/work/repository',
    };
    for (const configured of ['/', '/home/test', '/home', '/work', '/work/repository']) {
      expect(() => getStateDir({
        ...options,
        env: { GLMCP_STATE_DIR: configured },
      })).toThrow('GLMCP_STATE_DIR');
    }
  });

  it('allows a dedicated state child inside a workspace', () => {
    expect(getStateDir({
      env: { GLMCP_STATE_DIR: '.glmcp-state' },
      platform: 'linux',
      homeDir: '/home/test',
      currentDir: '/work/repository',
    })).toBe('/work/repository/.glmcp-state');
  });

  it('uses XDG_STATE_HOME when configured', () => {
    expect(getStateDir({
      env: { XDG_STATE_HOME: '/var/state' },
      platform: 'linux',
      homeDir: '/home/test',
    })).toBe('/var/state/german-legal-mcp');
  });

  it('uses LOCALAPPDATA on Windows', () => {
    expect(getStateDir({
      env: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
      platform: 'win32',
      homeDir: 'C:\\Users\\test',
    })).toContain('german-legal-mcp');
  });

  it('preserves the existing Unix default for backwards compatibility', () => {
    expect(getStateDir({
      env: {},
      platform: 'linux',
      homeDir: '/home/test',
    })).toBe('/home/test/.local/share/german-legal-mcp');
  });

  it('owns every application state subpath', () => {
    expect(cachePath('a')).toBe(statePath('cache', 'a'));
    expect(sessionPath('a')).toBe(statePath('sessions', 'a'));
    expect(metricsPath('a')).toBe(statePath('metrics', 'a'));
    expect(socketPath('a')).toBe(statePath('sockets', 'a'));
    expect(lockPath('a')).toBe(statePath('locks', 'a'));
  });
});
