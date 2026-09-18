import { belongsToProject, isProjectCollaborationChannel } from '@/lib/project-channels';

export interface ActivityPreferences {
  selectedId: string | null;
  drafts: Record<string, string>;
  readAt: Record<string, number>;
}

export function activityStorageKey(
  workspaceId: string,
  projectId: string,
  userId: string,
) {
  return `oa:projects:activity:${workspaceId}:${projectId}:${encodeURIComponent(userId)}:v1`;
}

export function readActivityPreferences(
  raw: string | null,
  projectId: string,
  containerScoped = false,
): ActivityPreferences {
  const belongs = (id: string) => containerScoped ? isProjectCollaborationChannel(id) : belongsToProject(id, projectId);
  const empty: ActivityPreferences = {
    selectedId: null,
    drafts: {},
    readAt: {},
  };
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== 'object') return empty;
    const saved = value as Partial<ActivityPreferences>;
    const scopedEntries = (entries: unknown) =>
      entries && typeof entries === 'object'
        ? Object.entries(entries).filter(([id]) =>
            belongs(id),
          )
        : [];
    return {
      selectedId:
        typeof saved.selectedId === 'string' &&
        belongs(saved.selectedId)
          ? saved.selectedId
          : null,
      drafts: Object.fromEntries(
        scopedEntries(saved.drafts).filter(
          ([, draft]) => typeof draft === 'string',
        ),
      ),
      readAt: Object.fromEntries(
        scopedEntries(saved.readAt).filter(
          ([, time]) => typeof time === 'number' && Number.isFinite(time),
        ),
      ),
    };
  } catch {
    return empty;
  }
}

const COPY = {
  'zh-CN': {
    conversations: '项目会话',
    newConversation: '新建会话',
    title: '会话名称',
    empty: '暂无会话',
    select: '选择一个会话',
    noMessages: '暂无消息',
    rename: '重命名会话',
    delete: '删除会话',
    deleteDescription: '确定删除这个会话吗？',
    participants: '参与 Agent',
    noAgents: '暂无 Agent',
    back: '返回会话列表',
    share: '复制项目链接',
    copied: '链接已复制',
    copyFailed: '无法复制链接',
    refresh: '刷新会话',
    retry: '重试',
    loadFailed: '无法加载项目会话',
    operationFailed: '操作失败，请重试',
    sendFailed: '发送失败',
    retrySend: '重新发送',
    dismiss: '取消重发',
    storageFailed: '无法保存本地草稿和会话状态',
    required: '请输入会话名称',
    tooLong: '名称不能超过 60 个字符',
    create: '创建',
    save: '保存',
    cancel: '取消',
    loading: '加载中',
    offline: '离线',
  },
  'en-US': {
    conversations: 'Project conversations',
    newConversation: 'New conversation',
    title: 'Conversation name',
    empty: 'No conversations',
    select: 'Select a conversation',
    noMessages: 'No messages yet',
    rename: 'Rename conversation',
    delete: 'Delete conversation',
    deleteDescription: 'Delete this conversation?',
    participants: 'Participating agents',
    noAgents: 'No agents available',
    back: 'Back to conversations',
    share: 'Copy project link',
    copied: 'Link copied',
    copyFailed: 'Could not copy link',
    refresh: 'Refresh conversations',
    retry: 'Retry',
    loadFailed: 'Could not load project conversations',
    operationFailed: 'Operation failed. Please retry.',
    sendFailed: 'Message could not be sent',
    retrySend: 'Retry send',
    dismiss: 'Dismiss retry',
    storageFailed: 'Could not save local drafts and conversation preferences',
    required: 'Enter a conversation name',
    tooLong: 'Names must be 60 characters or fewer',
    create: 'Create',
    save: 'Save',
    cancel: 'Cancel',
    loading: 'Loading',
    offline: 'Offline',
  },
};

export function activityLabels(locale: string) {
  return locale === 'zh-CN' ? COPY['zh-CN'] : COPY['en-US'];
}
