import { gql } from "@apollo/client/core";

// ── Velocity ──────────────────────────────────────────────

export const VELOCITY_QUERY = gql`
  query Velocity {
    developerLearningRate {
      owner { name }
      sprint { name }
      tasks
      avgBlowUpRatio
    }
    phaseTimingDistribution {
      sprint { name }
      taskNum
      phase
      seconds
      pctOfTotal
    }
    tokenEfficiencyTrend {
      sprint { name }
      complexity
      tasks
      avgTokensPerTask
    }
    blowUpFactors {
      sprint { name }
      taskNum
      title
      type
      complexity
      estimatedMinutes
      actualMinutes
      blowUpRatio
      reversions
      testingPosture
    }
    estimationAccuracyByType {
      type
      tasks
      avgEstimated
      avgActual
      blowUpRatio
    }
    estimationAccuracyByComplexity {
      complexity
      tasks
      blowUpRatio
    }
  }
`;

// ── Skills ────────────────────────────────────────────────

export const SKILLS_QUERY = gql`
  query Skills {
    skillUsage {
      skill { name }
      invocations
      sessions
      firstUsed
      lastUsed
    }
    skillTokenUsage {
      skill { name }
      sprint { name }
      invocations
      totalInputTokens
      totalOutputTokens
      avgTokensPerCall
    }
    skillDuration {
      skill { name }
      sprint { name }
      taskNum
      seconds
    }
    skillPrecision {
      sprint { name }
      taskNum
      filesRead
      filesModified
      explorationRatio
    }
    skillVersionTokenUsage {
      skill { name }
      skillVersion
      invocations
      totalInputTokens
      totalOutputTokens
      avgTokensPerCall
    }
    skillVersionDuration {
      skill { name }
      skillVersion
      invocations
      avgSeconds
      minSeconds
      maxSeconds
    }
    skillVersionPrecision {
      skill { name }
      skillVersion
      tasks
      avgExplorationRatio
    }
  }
`;

// ── Team ──────────────────────────────────────────────────

export const TEAM_QUERY = gql`
  query Team {
    developers {
      name
      fullName
      role
      skills {
        category
        skill
        rating
      }
      tasks(status: "red") {
        sprint
        taskNum
        title
      }
      velocity {
        avgMinutes
        blowUpRatio
        totalTasksCompleted
      }
    }
    developerQuality {
      owner { name }
      totalTasks
      totalReversions
      reversionsPerTask
      aGrades
      aGradePct
    }
    developerLearningRate {
      owner { name }
      sprint { name }
      tasks
      avgBlowUpRatio
    }
    commonAuditFindings {
      owner { name }
      fakeTestIncidents
      patternViolations
      belowAGrade
      totalTasks
    }
  }
`;

// ── Streams (Session Timeline Gantt) ─────────────────────

export const STREAMS_QUERY = gql`
  query Streams {
    sessionTimeline {
      sessionId
      developer { name }
      sprint { name }
      taskNum
      taskTitle
      skillName
      startedAt
      endedAt
      durationMinutes
      totalInputTokens
      totalOutputTokens
      toolCallCount
      messageCount
      model
      subagents {
        sessionId
        startedAt
        endedAt
        durationMinutes
        totalInputTokens
        totalOutputTokens
        toolCallCount
        model
      }
    }
  }
`;

// ── Tasks Board (Task Gantt) ─────────────────────────────

export const TASKS_BOARD_QUERY = gql`
  query TasksBoard {
    tasks {
      sprint
      taskNum
      title
      spec
      status
      blockedReason
      type
      owner {
        name
      }
      complexity
      startedAt
      completedAt
      estimatedMinutes
      actualMinutes
      blowUpRatio
      dependencies {
        sprint
        taskNum
      }
      dependents {
        sprint
        taskNum
      }
    }
    sprints {
      name
      projectId
    }
  }
`;

// ── Task Mutations ──────────────────────────────────────────

export const CLAIM_TASK_MUTATION = gql`
  mutation ClaimTask($sprint: String!, $taskNum: Int!, $developer: String!) {
    claimTask(sprint: $sprint, taskNum: $taskNum, developer: $developer) {
      sprint
      taskNum
      status
      owner {
        name
      }
    }
  }
`;

export const UNCLAIM_TASK_MUTATION = gql`
  mutation UnclaimTask($sprint: String!, $taskNum: Int!) {
    unclaimTask(sprint: $sprint, taskNum: $taskNum) {
      sprint
      taskNum
      status
      owner {
        name
      }
    }
  }
`;

export const ASSIGN_TASK_MUTATION = gql`
  mutation AssignTask($sprint: String!, $taskNum: Int!, $developer: String!) {
    assignTask(sprint: $sprint, taskNum: $taskNum, developer: $developer) {
      sprint
      taskNum
      status
      owner {
        name
      }
    }
  }
`;

export const RESOLVE_STALE_TASKS_MUTATION = gql`
  mutation ResolveStaleTasks {
    resolveStaleTasks {
      sprint
      taskNum
      status
      owner {
        name
      }
    }
  }
`;

// ── Conversation Feed ────────────────────────────────────

export const CONVERSATION_FEED_QUERY = gql`
  query ConversationFeed($limit: Int, $developer: String) {
    conversationFeed(limit: $limit, developer: $developer) {
      sessionId
      developer { name }
      sprint { name }
      taskNum
      taskTitle
      startedAt
      endedAt
      model
      messages {
        role
        content
        timestamp
        toolCalls {
          name
          summary
        }
      }
    }
  }
`;

// ── Toggl Time Tracking (live API) ───────────────────────

export const TOGGL_ME_QUERY = gql`
  query TogglMe {
    togglMe { id fullname email }
  }
`;

export const TOGGL_WORKSPACE_QUERY = gql`
  query TogglWorkspace {
    togglWorkspace { id name }
  }
`;

export const TOGGL_MEMBERS_QUERY = gql`
  query TogglMembers {
    togglMembers { id togglName email role active }
  }
`;

export const TOGGL_TIME_ENTRIES_QUERY = gql`
  query TogglTimeEntries($startDate: String!, $endDate: String!) {
    togglTimeEntries(startDate: $startDate, endDate: $endDate) {
      id description start stop seconds projectId tagIds userId
    }
  }
`;

export const TOGGL_PROJECTS_QUERY = gql`
  query TogglProjects {
    togglProjects { id name clientId color active }
  }
`;

export const TOGGL_CLIENTS_QUERY = gql`
  query TogglClients {
    togglClients { id name }
  }
`;

export const TOGGL_TAGS_QUERY = gql`
  query TogglTags {
    togglTags { id name }
  }
`;

export const TOGGL_CURRENT_TIMER_QUERY = gql`
  query TogglCurrentTimer {
    togglCurrentTimer { description start duration projectId }
  }
`;

export const TOGGL_DASHBOARD_ACTIVITY_QUERY = gql`
  query TogglDashboardActivity {
    togglDashboardActivity { userId description duration projectId start stop }
  }
`;

export const UPDATE_TOGGL_MEMBER_MUTATION = gql`
  mutation UpdateTogglMember($id: Int!, $role: String, $active: Boolean) {
    updateTogglMember(id: $id, role: $role, active: $active) {
      id togglName email role active
    }
  }
`;

// ── Data Health ──────────────────────────────────────────

export const DATA_HEALTH_QUERY = gql`
  query DataHealth {
    dataHealth {
      lastSessionEndedAt
      streams {
        stream
        count
        lastUpdated
        recentCount
      }
    }
  }
`;

