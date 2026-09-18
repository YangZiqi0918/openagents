'use client';

import { createContext, useContext } from 'react';
import { workspaceApi, type WorkspaceApi } from './api';

const WorkspaceApiContext = createContext<WorkspaceApi | null>(null);

export const WorkspaceApiProvider = WorkspaceApiContext.Provider;

export function useWorkspaceApi(): WorkspaceApi {
  // Legacy routes and isolated component tests may not provide a scope yet.
  return useContext(WorkspaceApiContext) ?? workspaceApi;
}
