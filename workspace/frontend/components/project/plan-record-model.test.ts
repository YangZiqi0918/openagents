import { describe, expect, it } from 'vitest';
import { isDate, readPlanRecords, validDates } from './plan-record-model';

const legacy = {
  id: 'old',
  title: '历史待办',
  status: 'doing',
  priority: 'medium',
  tags: ['前端'],
  assignee: { id: 'human:old', name: '成员', kind: 'human' },
};
describe('Plan record compatibility', () => {
  it('normalizes legacy records without losing the old priority or assignee', () => {
    expect(readPlanRecords(JSON.stringify([legacy]))[0]).toEqual({
      id: 'old',
      title: '历史待办',
      description: '',
      acceptanceCriteria: '',
      status: 'doing',
      priority: 'medium',
      tags: ['前端'],
      assignees: [legacy.assignee],
      startDate: null,
      dueDate: null,
      attachments: [],
    });
  });
  it('accepts paused, urgent, nullable priority and multiple assignees', () => {
    const row = {
      ...legacy,
      assignees: [legacy.assignee, { id: 'agent:codex', name: 'Codex', kind: 'agent' }],
      status: 'paused',
      priority: 'urgent',
    };
    expect(readPlanRecords(JSON.stringify([row]))[0]).toMatchObject({
      status: 'paused',
      priority: 'urgent',
      assignees: row.assignees,
    });
    expect(readPlanRecords(JSON.stringify([{ ...row, priority: null }]))[0].priority).toBeNull();
  });
  it('preserves acceptance criteria while defaulting older records to an empty value', () => {
    expect(readPlanRecords(JSON.stringify([{ ...legacy, acceptanceCriteria: '通过发布回归' }]))[0].acceptanceCriteria).toBe(
      '通过发布回归',
    );
    expect(readPlanRecords(JSON.stringify([legacy]))[0].acceptanceCriteria).toBe('');
  });
  it.each([
    { ...legacy, priority: 'custom' },
    { ...legacy, assignees: null },
    { ...legacy, description: 2 },
    { ...legacy, acceptanceCriteria: 2 },
    { ...legacy, startDate: '2026-02-30' },
    { ...legacy, attachments: [{ id: 'a', filename: 'a', contentType: 'text/plain', size: -1 }] },
  ])('rejects invalid data rather than overwriting it', (row) => {
    expect(() => readPlanRecords(JSON.stringify([row]))).toThrow();
  });
  it('validates real calendar dates and allows historical and equal dates', () => {
    expect(isDate('2024-02-29')).toBe(true);
    expect(isDate('2025-02-29')).toBe(false);
    expect(validDates('2020-01-01', '2020-01-01')).toBe(true);
    expect(validDates('2020-01-02', '2020-01-01')).toBe(false);
    expect(validDates(null, '2020-01-01')).toBe(true);
  });
});
