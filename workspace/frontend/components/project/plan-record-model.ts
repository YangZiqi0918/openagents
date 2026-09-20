export type Status = 'todo' | 'doing' | 'paused' | 'done';
export type Priority = 'urgent' | 'high' | 'medium' | 'low' | null;
export type Column = 'status' | 'assignee' | 'priority' | 'tags';
export interface Assignee {
  id: string;
  name: string;
  kind: 'human' | 'agent';
  avatarUrl?: string | null;
}
export interface PlanAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}
export interface PlanRecord {
  id: string;
  title: string;
  description: string;
  status: Status;
  assignees: Assignee[];
  priority: Priority;
  tags: string[];
  startDate: string | null;
  dueDate: string | null;
  attachments: PlanAttachment[];
  acceptanceCriteria?: string;
}
export interface Members {
  options: Assignee[];
  loading: boolean;
  error: boolean;
  retry?: () => void;
}
export const STATUSES: Status[] = ['todo', 'doing', 'paused', 'done'];
export const PRIORITIES: Priority[] = [null, 'urgent', 'high', 'medium', 'low'];
export const COLUMNS: Column[] = ['status', 'assignee', 'priority', 'tags'];
export const EMPTY_MEMBERS: Members = { options: [], loading: false, error: false };
export const uniqueTags = (tags: string[]) => Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
export function todayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validDates(start: string | null, due: string | null) {
  return (!start || isDate(start)) && (!due || isDate(due)) && (!start || !due || due >= start);
}
function isAssignee(value: unknown): value is Assignee {
  if (!value || typeof value !== 'object') return false;
  const item = value as Assignee;
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.name === 'string' &&
    (item.kind === 'human' || item.kind === 'agent') &&
    (item.avatarUrl === undefined || item.avatarUrl === null || typeof item.avatarUrl === 'string')
  );
}
function normalizeRecord(value: unknown): PlanRecord {
  if (!value || typeof value !== 'object') throw new Error('Invalid plan record');
  const row = value as Record<string, unknown>;
  const assignees = 'assignees' in row ? row.assignees : row.assignee === null ? [] : [row.assignee];
  const description = row.description === undefined ? '' : row.description;
  const acceptanceCriteria = row.acceptanceCriteria === undefined ? '' : row.acceptanceCriteria;
  const startDate = row.startDate === undefined ? null : row.startDate;
  const dueDate = row.dueDate === undefined ? null : row.dueDate;
  const attachments = row.attachments === undefined ? [] : row.attachments;
  if (
    typeof row.id !== 'string' ||
    !row.id ||
    typeof row.title !== 'string' ||
    !row.title.trim() ||
    typeof description !== 'string' ||
    typeof acceptanceCriteria !== 'string' ||
    !STATUSES.includes(row.status as Status) ||
    !PRIORITIES.includes(row.priority as Priority) ||
    !Array.isArray(row.tags) ||
    !row.tags.every((tag) => typeof tag === 'string') ||
    !Array.isArray(assignees) ||
    !assignees.every(isAssignee) ||
    (startDate !== null && !isDate(startDate)) ||
    (dueDate !== null && !isDate(dueDate)) ||
    !validDates(startDate as string | null, dueDate as string | null) ||
    !Array.isArray(attachments) ||
    !attachments.every(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        item.id &&
        typeof item.filename === 'string' &&
        typeof item.contentType === 'string' &&
        typeof item.size === 'number' &&
        Number.isFinite(item.size) &&
        item.size >= 0,
    )
  ) {
    throw new Error('Invalid plan record');
  }
  return {
    id: row.id,
    title: row.title,
    description,
    acceptanceCriteria,
    status: row.status as Status,
    assignees: assignees.filter((member, index) => assignees.findIndex((other) => other.id === member.id) === index),
    priority: row.priority as Priority,
    tags: uniqueTags(row.tags),
    startDate: startDate as string | null,
    dueDate: dueDate as string | null,
    attachments: attachments.map(({ id, filename, contentType, size }) => ({ id, filename, contentType, size })),
  };
}
export function readPlanRecords(raw: string | null): PlanRecord[] {
  const parsed: unknown = raw === null ? [] : JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Invalid plan records');
  const records = parsed.map(normalizeRecord);
  if (new Set(records.map((row) => row.id)).size !== records.length) throw new Error('Duplicate plan record');
  return records;
}
export function newPlanRecord(): PlanRecord {
  return {
    id: crypto.randomUUID(),
    title: '',
    description: '',
    acceptanceCriteria: '',
    status: 'todo',
    assignees: [],
    priority: null,
    tags: [],
    startDate: null,
    dueDate: null,
    attachments: [],
  };
}
const COPY = {
  'zh-CN': {
    table: '表格',
    board: '看板',
    add: '添加',
    addRow: '添加记录',
    title: '标题',
    description: '描述',
    acceptanceCriteria: '验收标准',
    status: '状态',
    assignee: '处理人',
    priority: '优先级',
    tags: '标签',
    todo: '待开始',
    doing: '进行中',
    paused: '已暂停',
    done: '已完成',
    urgent: '紧急',
    low: '低',
    medium: '中',
    high: '高',
    none: '无',
    unassigned: '未分配',
    all: '全部',
    filter: '筛选',
    search: '搜索',
    searchPlaceholder: '搜索标题、描述、处理人或标签',
    columns: '列设置',
    clear: '清空筛选',
    closeSearch: '关闭搜索',
    selectAll: '全选当前记录',
    selectRow: '选择记录',
    delete: '删除所选记录',
    deleteTitle: '删除所选记录？',
    deleteDescription: '删除后无法恢复。',
    cancel: '取消',
    confirm: '确认删除',
    required: '标题不能为空',
    edit: '编辑',
    details: '编辑待办详情',
    noResults: '没有匹配的记录',
    loading: '正在加载计划',
    loadError: '计划数据无法读取，原有数据未被覆盖。',
    saveError: '保存失败，当前修改尚未保存。',
    retry: '重试',
    reset: '重置计划数据',
    resetTitle: '重置计划数据？',
    resetDescription: '这会清空当前项目在此浏览器中保存的计划记录。',
    resetConfirm: '确认重置',
    memberError: '工作区成员加载失败',
    memberLoading: '正在加载成员',
    human: '成员',
    agent: '智能体',
    memberSearch: '搜索成员',
    noMembers: '没有匹配的成员',
    tagSearch: '搜索或新增标签',
    noTags: '暂无标签',
    newTag: '新增标签',
    createTitle: '新建待办',
    titlePlaceholder: '请输入标题',
    descriptionPlaceholder: '添加描述（可选）',
    create: '创建',
    save: '保存',
    expand: '放大',
    restore: '还原',
    close: '关闭',
    startDate: '开始日期',
    dueDate: '截止日期',
    clearDate: '清除',
    today: '今天',
    dateError: '截止日期不得早于开始日期，请检查日期。',
    discardTitle: '放弃未保存的修改？',
    discardDescription: '退出后，未保存的修改将被丢弃。',
    discard: '放弃修改',
    keepEditing: '继续编辑',
    attachment: '添加附件',
    removeAttachment: '移除附件',
    viewAttachment: '查看附件',
    previewUpload: '预览模式不支持附件上传',
    uploadFailed: '附件上传失败，请重试或移除失败附件。',
    cancelUpload: '取消上传',
    uploadCancelled: '上传已取消，尚未保存待办。',
    formSaveError: '待办保存失败，草稿已保留，请重试。',
    submitting: '正在提交',
  },
  'en-US': {
    table: 'Table',
    board: 'Board',
    add: 'Add',
    addRow: 'Add record',
    title: 'Title',
    description: 'Description',
    acceptanceCriteria: 'Acceptance criteria',
    status: 'Status',
    assignee: 'Assignee',
    priority: 'Priority',
    tags: 'Tags',
    todo: 'Not started',
    doing: 'In progress',
    paused: 'Paused',
    done: 'Completed',
    urgent: 'Urgent',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    none: 'None',
    unassigned: 'Unassigned',
    all: 'All',
    filter: 'Filter',
    search: 'Search',
    searchPlaceholder: 'Search titles, descriptions, assignees or tags',
    columns: 'Columns',
    clear: 'Clear filters',
    closeSearch: 'Close search',
    selectAll: 'Select visible records',
    selectRow: 'Select record',
    delete: 'Delete selected records',
    deleteTitle: 'Delete selected records?',
    deleteDescription: 'This cannot be undone.',
    cancel: 'Cancel',
    confirm: 'Confirm delete',
    required: 'A title is required',
    edit: 'Edit',
    details: 'Edit record details',
    noResults: 'No matching records',
    loading: 'Loading plan',
    loadError: 'Plan data could not be read. Existing data has not been overwritten.',
    saveError: 'Save failed. Current changes are not saved.',
    retry: 'Retry',
    reset: 'Reset plan data',
    resetTitle: 'Reset plan data?',
    resetDescription: "This clears this project's plan records saved in this browser.",
    resetConfirm: 'Confirm reset',
    memberError: 'Workspace members could not be loaded',
    memberLoading: 'Loading members',
    human: 'Members',
    agent: 'Agents',
    memberSearch: 'Search members',
    noMembers: 'No matching members',
    tagSearch: 'Search or add tags',
    noTags: 'No tags yet',
    newTag: 'Add tag',
    createTitle: 'New record',
    titlePlaceholder: 'Enter a title',
    descriptionPlaceholder: 'Add a description (optional)',
    create: 'Create',
    save: 'Save',
    expand: 'Expand',
    restore: 'Restore',
    close: 'Close',
    startDate: 'Start date',
    dueDate: 'Due date',
    clearDate: 'Clear',
    today: 'Today',
    dateError: 'Due date must not be earlier than start date. Check the dates.',
    discardTitle: 'Discard unsaved changes?',
    discardDescription: 'Your unsaved changes will be discarded.',
    discard: 'Discard changes',
    keepEditing: 'Keep editing',
    attachment: 'Add attachments',
    removeAttachment: 'Remove attachment',
    viewAttachment: 'View attachment',
    previewUpload: 'Attachments cannot be uploaded in preview mode',
    uploadFailed: 'Attachment upload failed. Retry or remove the failed files.',
    cancelUpload: 'Cancel upload',
    uploadCancelled: 'Upload cancelled. The record has not been saved.',
    formSaveError: 'The record could not be saved. Your draft is retained. Please retry.',
    submitting: 'Submitting',
  },
};
export type PlanLabels = (typeof COPY)['en-US'];
export const planLabels = (locale: string): PlanLabels => (locale === 'zh-CN' ? COPY['zh-CN'] : COPY['en-US']);
