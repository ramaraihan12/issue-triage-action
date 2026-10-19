import { describe, expect, it } from 'vitest';
import { MARKER, renderComment, sanitize } from '../src/comment';

describe('sanitize', () => {
  it('drops links, html and mentions', () => {
    expect(sanitize('see <img src=x> https://evil.example/x and ping @octocat')).toBe(
      'see img src=x and ping octocat',
    );
  });

  it('drops links without a scheme', () => {
    expect(sanitize('download the fix from www.evil-example.com/patch now')).toBe(
      'download the fix from now',
    );
    expect(sanitize('see WWW.evil-example.com or evil-example.com/fix?x=1')).toBe('see or');
  });

  it('drops issue references and html entities', () => {
    expect(sanitize('see torvalds/linux#1 and #12 or GH-7 for details')).toBe(
      'see and or for details',
    );
    expect(sanitize('ping &#64;octocat or &#x40;hubot')).toBe('ping octocat or hubot');
  });

  it('keeps file names and paths', () => {
    expect(sanitize('your mdsite.config.yml and the files under content/blog')).toBe(
      'your mdsite.config.yml and the files under content/blog',
    );
  });

  it('collapses whitespace', () => {
    expect(sanitize('  the   full\nerror output ')).toBe('the full error output');
  });

  it('cuts long text', () => {
    const out = sanitize('word '.repeat(100), 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith('...')).toBe(true);
  });
});

describe('renderComment', () => {
  it('returns null when there is nothing useful to say', () => {
    expect(renderComment({ category: 'bug', duplicates: [], missingInfo: [] })).toBeNull();
  });

  it('points at a single likely duplicate', () => {
    const body = renderComment({
      category: 'bug',
      duplicates: [{ number: 12, title: 'Crash without config', body: '' }],
      missingInfo: [],
    });
    expect(body?.startsWith(MARKER)).toBe(true);
    expect(body).toContain('It reads like a bug report.');
    expect(body).toContain('It might be the same as #12 (Crash without config).');
    expect(body).not.toContain('could you add');
  });

  it('lists several duplicates and the missing details', () => {
    const body = renderComment({
      category: 'feature',
      duplicates: [
        { number: 3, title: 'Dark mode', body: '' },
        { number: 9, title: 'Theme support', body: '' },
      ],
      missingInfo: ['version', 'expected_vs_actual'],
    });
    expect(body).toContain('a feature request');
    expect(body).toContain('- #3 Dark mode\n- #9 Theme support');
    expect(body).toContain(
      'could you add:\n- the version you are running\n- what you expected to happen and what happened instead',
    );
  });
});
