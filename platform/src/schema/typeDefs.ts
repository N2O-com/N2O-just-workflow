export const typeDefs = `#graphql
  type Query {
    # Tasks
    task(sprint: String!, taskNum: Int!): Task
    tasks(sprint: String, status: String, owner: String, horizon: String): [Task!]!
    availableTasks: [Task!]!

    # Sprints
    sprint(name: String!): Sprint
    sprints(status: String, projectId: String): [Sprint!]!

    # Projects
    project(id: ID!): Project
    projects: [Project!]!

    # Developers
    developer(name: String!): Developer
    developers: [Developer!]!

    # Activity
    activityLog(limit: Int, developer: String): [Activity!]!

    # Events
    events(sessionId: String, sprint: String, taskNum: Int, eventType: String, limit: Int): [Event!]!

    # Transcripts
    transcripts(sprint: String, taskNum: Int, sessionId: String): [Transcript!]!
  }

  type Mutation {
    # Contributor availability (manual entry)
    setAvailability(
      developer: String!
      date: String!
      expectedMinutes: Float!
      effectiveness: Float
      status: String
      notes: String
    ): Availability!

    # Developer skills
    setSkill(
      developer: String!
      category: String!
      skill: String!
      rating: Float!
      source: String
    ): DeveloperSkill!

    # Developer context snapshot
    recordContext(
      developer: String!
      concurrentSessions: Int
      hourOfDay: Int
      alertness: Float
      environment: String
    ): DeveloperContext!

    # Activity log
    logActivity(
      developer: String
      action: String!
      sprint: String
      taskNum: Int
      summary: String
      metadata: String
    ): Activity!
  }

  # ── Core Entities ──────────────────────────────────────────

  type Task {
    sprint: String!
    taskNum: Int!
    spec: String
    title: String!
    description: String
    doneWhen: String
    status: String!
    blockedReason: String
    type: String
    complexity: Float
    estimatedMinutes: Float
    priority: Float
    horizon: String
    startedAt: String
    completedAt: String
    reversions: Int
    testingPosture: String
    verified: Boolean
    commitHash: String

    # Relationships
    owner: Developer
    dependencies: [Task!]!
    dependents: [Task!]!
    events(eventType: String, limit: Int): [Event!]!
    transcripts: [Transcript!]!

    # Computed
    actualMinutes: Float
    blowUpRatio: Float
  }

  type Sprint {
    name: String!
    projectId: String
    startAt: String
    endAt: String
    deadline: String
    goal: String
    status: String!

    # Relationships
    project: Project
    tasks(status: String): [Task!]!

    # Computed
    progress: SprintProgress!
  }

  type SprintProgress {
    totalTasks: Int!
    pending: Int!
    red: Int!
    green: Int!
    blocked: Int!
    percentComplete: Float!
    remainingMinutes: Float
  }

  type Project {
    id: ID!
    name: String!
    description: String
    repoUrl: String
    startAt: String
    endAt: String
    status: String!
    metadata: String

    # Relationships
    sprints(status: String): [Sprint!]!
  }

  type Developer {
    name: String!
    fullName: String!
    role: String
    baselineCompetency: Float
    strengths: String
    growthAreas: String

    # Relationships
    skills: [DeveloperSkill!]!
    tasks(status: String, sprint: String): [Task!]!
    availability(date: String): Availability
    context(latest: Boolean): [DeveloperContext!]!

    # Computed
    velocity: VelocityProfile
  }

  # ── Supporting Types ───────────────────────────────────────

  type DeveloperSkill {
    developer: String!
    category: String!
    skill: String!
    rating: Float!
    source: String
    evidence: String
    assessedAt: String
  }

  type DeveloperContext {
    id: Int!
    developer: String!
    recordedAt: String!
    concurrentSessions: Int!
    hourOfDay: Int
    alertness: Float
    environment: String
    notes: String
  }

  type Availability {
    developer: String!
    date: String!
    expectedMinutes: Float!
    effectiveness: Float!
    status: String!
    notes: String
  }

  type VelocityProfile {
    avgMinutes: Float
    blowUpRatio: Float
    totalTasksCompleted: Int!
  }

  type Event {
    id: Int!
    timestamp: String!
    sessionId: String
    sprint: String
    taskNum: Int
    eventType: String!
    toolName: String
    skillName: String
    skillVersion: String
    phase: String
    agentId: String
    agentType: String
    inputTokens: Int
    outputTokens: Int
  }

  type Transcript {
    id: Int!
    sessionId: String!
    parentSessionId: String
    filePath: String!
    fileSize: Int
    messageCount: Int
    userMessageCount: Int
    assistantMessageCount: Int
    toolCallCount: Int
    totalInputTokens: Int
    totalOutputTokens: Int
    model: String
    startedAt: String
    endedAt: String
    sprint: String
    taskNum: Int
  }

  type Activity {
    id: Int!
    timestamp: String!
    developer: String
    action: String!
    sprint: String
    taskNum: Int
    summary: String
    metadata: String
  }
`;
