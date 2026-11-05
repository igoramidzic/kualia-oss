import { describe, expect, it } from 'vitest';

import { buildSystemPrompt } from './prompts';

describe('buildSystemPrompt', () => {
  const FIXED_DATE = new Date('2026-05-06T12:00:00Z');

  it('omits the active-workspace block when no workspace context is provided', () => {
    const prompt = buildSystemPrompt(FIXED_DATE);
    expect(prompt).not.toContain('Active workspace:');
    expect(prompt).toContain('Current date:');
    expect(prompt).toContain('2026-05-06');
  });

  it('falls back to UTC when no timezone is provided', () => {
    const prompt = buildSystemPrompt(FIXED_DATE);
    expect(prompt).toContain('workspace timezone (UTC)');
    expect(prompt).toContain('2026-05-06');
  });

  it('formats today in the workspace timezone when one is provided', () => {
    // 2026-05-06T01:00Z is still 2026-05-05 in Los Angeles (UTC-7 / -8).
    const lateNightUtc = new Date('2026-05-06T01:00:00Z');
    const prompt = buildSystemPrompt(lateNightUtc, null, 'America/Los_Angeles');
    expect(prompt).toContain('2026-05-05');
    expect(prompt).toContain('America/Los_Angeles');
    expect(prompt).toContain('YYYYMM is 202605');
  });

  it('rolls the YYYYMM forward when the workspace zone is ahead of UTC across a month boundary', () => {
    // 2026-04-30T23:00Z is already 2026-05-01 in Tokyo (UTC+9).
    const nearMidnightUtc = new Date('2026-04-30T23:00:00Z');
    const prompt = buildSystemPrompt(nearMidnightUtc, null, 'Asia/Tokyo');
    expect(prompt).toContain('2026-05-01');
    expect(prompt).toContain('YYYYMM is 202605');
  });

  it('falls back to UTC for an invalid timezone string', () => {
    const prompt = buildSystemPrompt(FIXED_DATE, null, 'Not/A_Real_Zone');
    expect(prompt).toContain('2026-05-06');
    expect(prompt).toContain('workspace timezone (UTC)');
  });

  it('instructs the agent to always emit fully qualified docs URLs', () => {
    const prompt = buildSystemPrompt(FIXED_DATE);
    expect(prompt).toContain('https://docs.kualia.com');
    expect(prompt).toMatch(/fully qualified URL/i);
  });

  it('includes the support email for contact requests', () => {
    const prompt = buildSystemPrompt(FIXED_DATE);
    expect(prompt).toContain('support@kualia.com');
  });

  it('teaches the agent how to handle skipped duplicates from chat-file imports', () => {
    const prompt = buildSystemPrompt(FIXED_DATE);
    expect(prompt).toContain('skipped');
    expect(prompt).toContain('forceInsert');
    expect(prompt).toContain('duplicate');
  });

  it('pins the active workspace when context is provided', () => {
    const prompt = buildSystemPrompt(FIXED_DATE, {
      workspaceId: 'workspace_abc',
      workspaceName: 'Kualia Board',
    });
    expect(prompt).toContain('Active workspace:');
    expect(prompt).toContain('"Kualia Board"');
    expect(prompt).toContain('workspace_abc');
    expect(prompt).toContain('Current date:');
  });
});
