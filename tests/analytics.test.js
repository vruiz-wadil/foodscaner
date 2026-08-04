/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const analyticsCode = fs.readFileSync(path.join(__dirname, '..', 'analytics.js'), 'utf8')

describe('analytics.js', () => {
  beforeEach(() => {
    delete window.va
    delete window.vaq
    delete window.track
    document.head.innerHTML = ''
    new Function(analyticsCode)()
  })

  it('defines window.va as a queueing stub', () => {
    expect(typeof window.va).toBe('function')
    window.va('event', { name: 'test' })
    expect(window.vaq).toEqual([expect.objectContaining({ 0: 'event' })])
  })

  it('injects the Vercel Insights and Speed Insights script tags into <head>', () => {
    const scripts = Array.from(document.head.querySelectorAll('script')).map(s => s.src)
    expect(scripts.some(src => src.endsWith('/_vercel/insights/script.js'))).toBe(true)
    expect(scripts.some(src => src.endsWith('/_vercel/speed-insights/script.js'))).toBe(true)
  })

  it('window.track forwards to window.va with name/data shape', () => {
    const vaSpy = vi.fn()
    window.va = vaSpy
    window.track('Test Event', { foo: 'bar' })
    expect(vaSpy).toHaveBeenCalledWith('event', { name: 'Test Event', data: { foo: 'bar' } })
  })

  it('window.track defaults props to an empty object when omitted', () => {
    const vaSpy = vi.fn()
    window.va = vaSpy
    window.track('No Props Event')
    expect(vaSpy).toHaveBeenCalledWith('event', { name: 'No Props Event', data: {} })
  })
})
