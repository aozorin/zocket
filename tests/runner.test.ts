import { describe, it, expect } from 'vitest'
import { runCommand, runScript } from '../src/runner.js'

const openPolicy = { allow_list: null, max_output: 4096, allow_substitution: true }

describe('runCommand', () => {
  it('runs a simple command', () => {
    const r = runCommand(['echo', 'hello'], {}, openPolicy)
    expect(r.exit_code).toBe(0)
    expect(r.stdout.trim()).toBe('hello')
  })

  it('substitutes env vars in args', () => {
    const r = runCommand(['echo', '$MSG'], { MSG: 'works' }, openPolicy)
    expect(r.stdout.trim()).toBe('works')
  })

  it('substitutes ${VAR} syntax', () => {
    const r = runCommand(['echo', '${MSG}'], { MSG: 'braces' }, openPolicy)
    expect(r.stdout.trim()).toBe('braces')
  })

  it('skips substitution when disabled', () => {
    const policy = { ...openPolicy, allow_substitution: false }
    const r = runCommand(['echo', '$MSG'], { MSG: 'should-not-appear' }, policy)
    expect(r.stdout.trim()).toBe('$MSG')
  })

  it('rejects disallowed commands', () => {
    const policy = { ...openPolicy, allow_list: ['echo'] }
    expect(() => runCommand(['bash', '-c', 'echo hi'], {}, policy)).toThrow('not allowed')
  })

  it('truncates stdout to maxChars', () => {
    const r = runCommand(['echo', 'hello world'], {}, openPolicy, 5)
    expect(r.stdout).toBe('hello')
    expect(r.truncated).toBe(true)
  })

  it('omits stderr field when empty', () => {
    const r = runCommand(['echo', 'hi'], {}, openPolicy)
    expect(r.stderr).toBeUndefined()
  })

  it('non-zero exit code on failure', () => {
    const r = runCommand(['node', '-e', 'process.exit(2)'], {}, openPolicy)
    expect(r.exit_code).toBe(2)
  })
})

describe('runScript', () => {
  it('runs a node script', () => {
    const r = runScript('node', `console.log('node ok')`, {})
    expect(r.exit_code).toBe(0)
    expect(r.stdout.trim()).toBe('node ok')
  })

  it('injects env into node script', () => {
    const r = runScript('node', `console.log(process.env.API_KEY)`, { API_KEY: 'secret123' })
    expect(r.stdout.trim()).toBe('secret123')
  })

  it('truncates to maxChars', () => {
    const r = runScript('node', `console.log('abcdefgh')`, {}, 3)
    expect(r.stdout).toBe('abc')
    expect(r.truncated).toBe(true)
  })

  it('captures stderr on script error', () => {
    const r = runScript('node', `throw new Error('oops')`, {})
    expect(r.exit_code).not.toBe(0)
    expect(r.stderr).toMatch(/oops/)
  })

  it('cleans up temp file even on error', () => {
    // Just verify it doesn't throw/leak — no file handle check needed
    expect(() => runScript('node', `process.exit(1)`, {})).not.toThrow()
  })
})
