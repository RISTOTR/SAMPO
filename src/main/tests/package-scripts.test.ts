import { describe, expect, it } from 'vitest'
import packageJson from '../../../package.json'

describe('native rebuild scripts', () => {
  it('force-rebuilds better-sqlite3 for Electron dev startup after Node test rebuilds', () => {
    expect(packageJson.scripts['rebuild:native:node']).toBe('npm rebuild better-sqlite3')
    expect(packageJson.scripts['rebuild:native:electron']).toContain('electron-rebuild')
    expect(packageJson.scripts['rebuild:native:electron']).toContain('-f')
    expect(packageJson.scripts['rebuild:native:electron']).toContain('better-sqlite3')
  })
})
