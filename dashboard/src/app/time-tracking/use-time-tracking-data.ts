"use client";

import { useQuery, useMutation } from "@apollo/client/react";
import { useMemo } from "react";
import {
  TOGGL_ME_QUERY,
  TOGGL_WORKSPACE_QUERY,
  TOGGL_MEMBERS_QUERY,
  TOGGL_TIME_ENTRIES_QUERY,
  TOGGL_PROJECTS_QUERY,
  TOGGL_CLIENTS_QUERY,
  TOGGL_TAGS_QUERY,
  TOGGL_CURRENT_TIMER_QUERY,
  TOGGL_DASHBOARD_ACTIVITY_QUERY,
  UPDATE_TOGGL_MEMBER_MUTATION,
} from "@/lib/graphql/queries";

const FIVE_MIN = 5 * 60 * 1000;

export interface TimeTrackingMember {
  id: number;
  togglName: string;
  email: string | null;
  role: string;
  active: boolean;
}

export interface TimeEntry {
  id: number | null;
  description: string;
  start: string;
  stop: string | null;
  seconds: number;
  projectId: number | null;
  tagIds: number[];
  userId: number;
}

export interface TogglProject {
  id: number;
  name: string;
  clientId: number | null;
  color: string;
  active: boolean;
}

export interface TogglClient {
  id: number;
  name: string;
}

export interface TogglTag {
  id: number;
  name: string;
}

export interface DashboardActivity {
  userId: number;
  description: string;
  duration: number;
  projectId: number | null;
  start: string;
  stop: string | null;
}

export function useTimeTrackingData(startDate: string, endDate: string) {
  const { data: meData, loading: meLoading } = useQuery(TOGGL_ME_QUERY);
  const { data: wsData, loading: wsLoading } = useQuery(TOGGL_WORKSPACE_QUERY);

  const { data: membersData, loading: membersLoading, refetch: refetchMembers } =
    useQuery(TOGGL_MEMBERS_QUERY);

  const { data: entriesData, loading: entriesLoading } = useQuery(
    TOGGL_TIME_ENTRIES_QUERY,
    { variables: { startDate, endDate }, pollInterval: FIVE_MIN }
  );

  const { data: activityData, loading: activityLoading } = useQuery(
    TOGGL_DASHBOARD_ACTIVITY_QUERY,
    { pollInterval: FIVE_MIN }
  );

  const { data: projectsData, loading: projectsLoading } = useQuery(TOGGL_PROJECTS_QUERY);
  const { data: clientsData, loading: clientsLoading } = useQuery(TOGGL_CLIENTS_QUERY);
  const { data: tagsData, loading: tagsLoading } = useQuery(TOGGL_TAGS_QUERY);

  const { data: timerData } = useQuery(TOGGL_CURRENT_TIMER_QUERY, {
    pollInterval: FIVE_MIN,
  });

  const [updateMember] = useMutation(UPDATE_TOGGL_MEMBER_MUTATION);

  const me = meData?.togglMe ?? null;
  const workspace = wsData?.togglWorkspace ?? null;
  const members: TimeTrackingMember[] = membersData?.togglMembers ?? [];
  const entries: TimeEntry[] = entriesData?.togglTimeEntries ?? [];
  const dashboardActivity: DashboardActivity[] = activityData?.togglDashboardActivity ?? [];
  const projects: TogglProject[] = projectsData?.togglProjects ?? [];
  const clients: TogglClient[] = clientsData?.togglClients ?? [];
  const tags: TogglTag[] = tagsData?.togglTags ?? [];
  const currentTimer = timerData?.togglCurrentTimer ?? null;

  // Build lookup maps for fast access
  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects]
  );

  const clientMap = useMemo(
    () => new Map(clients.map((c) => [c.id, c])),
    [clients]
  );

  // Build current entries map from dashboard activity (running timers per user)
  const currentEntries = useMemo(() => {
    const map: Record<number, DashboardActivity> = {};
    for (const a of dashboardActivity) {
      if (a.duration < 0) {
        // Negative duration = running timer
        map[a.userId] = a;
      }
    }
    return map;
  }, [dashboardActivity]);

  const loading =
    meLoading || wsLoading || membersLoading || entriesLoading ||
    activityLoading || projectsLoading || clientsLoading || tagsLoading;

  return {
    me,
    workspace,
    members,
    entries,
    dashboardActivity,
    currentEntries,
    currentTimer,
    projects,
    clients,
    tags,
    projectMap,
    clientMap,
    loading,
    updateMember: async (id: number, role?: string, active?: boolean) => {
      await updateMember({ variables: { id, role, active } });
      refetchMembers();
    },
  };
}
