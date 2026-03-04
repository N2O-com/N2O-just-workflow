import { gql } from "@apollo/client/core";

// ── Velocity ──────────────────────────────────────────────

export const VELOCITY_QUERY = gql`
  query Velocity {
    developerLearningRate {
      owner
      sprint
      tasks
      avgBlowUpRatio
    }
    phaseTimingDistribution {
      sprint
      taskNum
      phase
      seconds
      pctOfTotal
    }
    tokenEfficiencyTrend {
      sprint
      complexity
      tasks
      avgTokensPerTask
    }
    blowUpFactors {
      sprint
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
      toolName
      invocations
      sessions
      firstUsed
      lastUsed
    }
    skillTokenUsage {
      skillName
      sprint
      invocations
      totalInputTokens
      totalOutputTokens
      avgTokensPerCall
    }
    skillDuration {
      skillName
      sprint
      taskNum
      seconds
    }
    skillPrecision {
      sprint
      taskNum
      filesRead
      filesModified
      explorationRatio
    }
    skillVersionTokenUsage {
      skillName
      skillVersion
      invocations
      totalInputTokens
      totalOutputTokens
      avgTokensPerCall
    }
    skillVersionDuration {
      skillName
      skillVersion
      invocations
      avgSeconds
      minSeconds
      maxSeconds
    }
    skillVersionPrecision {
      skillName
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
      owner
      totalTasks
      totalReversions
      reversionsPerTask
      aGrades
      aGradePct
    }
    developerLearningRate {
      owner
      sprint
      tasks
      avgBlowUpRatio
    }
    commonAuditFindings {
      owner
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
      developer
      sprint
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
  }
`;

// ── Conversation Feed ────────────────────────────────────

export const CONVERSATION_FEED_QUERY = gql`
  query ConversationFeed($limit: Int, $developer: String) {
    conversationFeed(limit: $limit, developer: $developer) {
      sessionId
      developer
      sprint
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

