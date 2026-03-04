export const typeDefs = `#graphql
  type Query {
    """Fetch a single task by sprint name and task number"""
    task(sprint: String!, taskNum: Int!): Task

    """List tasks with optional filters for sprint, status, owner, or horizon"""
    tasks(sprint: String, status: String, owner: String, horizon: String): [Task!]!

    """List tasks that are pending with all dependencies satisfied"""
    availableTasks: [Task!]!

    """Fetch a single sprint by name"""
    sprint(name: String!): Sprint

    """List sprints with optional status or project filter"""
    sprints(status: String, projectId: String): [Sprint!]!

    """Fetch a single project by ID"""
    project(id: ID!): Project

    """List all projects"""
    projects: [Project!]!

    """Fetch a single developer by name"""
    developer(name: String!): Developer

    """List all developers with their roles and competency profiles"""
    developers: [Developer!]!

    """Recent activity log entries: task completions, phase transitions, and manual logs"""
    activityLog(limit: Int, developer: String): [Activity!]!

    """Developer coding session conversations with messages and tool calls"""
    conversationFeed(limit: Int, developer: String): [SessionConversation!]!

    """Workflow events: phase transitions, tool invocations, agent activity"""
    events(sessionId: String, sprint: String, taskNum: Int, eventType: String, limit: Int): [Event!]!

    """Session transcripts with token counts, message counts, and timing"""
    transcripts(sprint: String, taskNum: Int, sessionId: String): [Transcript!]!

    # ── Analytics ──────────────────────────────────────────────

    """Skill/tool usage frequency: invocation counts and session counts per tool"""
    skillUsage(dateFrom: String, dateTo: String): [SkillUsage!]!

    """Token consumption per skill per sprint: input/output tokens and cost proxy"""
    skillTokenUsage(sprint: String): [SkillTokenUsage!]!

    """Token usage broken down by skill version for version-over-version comparison"""
    skillVersionTokenUsage(skillName: String): [SkillVersionTokenUsage!]!

    """Time spent per skill per sprint in seconds"""
    skillDuration(sprint: String): [SkillDuration!]!

    """Duration stats per skill version: avg, min, max seconds"""
    skillVersionDuration(skillName: String): [SkillVersionDuration!]!

    """Exploration ratio per skill: files read vs files modified (lower is more precise)"""
    skillPrecision(sprint: String): [SkillPrecision!]!

    """Precision stats per skill version: average exploration ratio across tasks"""
    skillVersionPrecision(skillName: String): [SkillVersionPrecision!]!

    """Developer learning rate: avg blow-up ratio per sprint showing improvement over time"""
    developerLearningRate(owner: String): [LearningRate!]!

    """Time distribution across TDD phases (RED, GREEN, REFACTOR, AUDIT) per task"""
    phaseTimingDistribution(sprint: String): [PhaseTimingDistribution!]!

    """Token efficiency trend: average tokens consumed per task by sprint and complexity"""
    tokenEfficiencyTrend: [TokenEfficiency!]!

    """Tasks that exceeded estimates: blow-up ratio, reversions, and testing posture"""
    blowUpFactors(sprint: String): [BlowUpFactor!]!

    """Estimation accuracy per developer: avg estimated vs actual hours and error"""
    estimationAccuracy(owner: String, dateFrom: String, dateTo: String): [EstimationAccuracy!]!

    """Estimation accuracy grouped by task type (database, frontend, infra, etc.)"""
    estimationAccuracyByType: [EstimationAccuracyByType!]!

    """Estimation accuracy grouped by complexity level (low, medium, high)"""
    estimationAccuracyByComplexity: [EstimationAccuracyByComplexity!]!

    """Developer quality metrics: reversions per task, A-grade testing percentage"""
    developerQuality(owner: String, dateFrom: String, dateTo: String): [DeveloperQuality!]!

    """Common audit findings per developer: fake tests, pattern violations, below-A grades"""
    commonAuditFindings(owner: String, dateFrom: String, dateTo: String): [AuditFindings!]!

    """Reversion hotspots by task type and complexity: where quality issues cluster"""
    reversionHotspots: [ReversionHotspot!]!

    """Sprint velocity: completed tasks, avg hours per task, total hours per sprint"""
    sprintVelocity(sprint: String, dateFrom: String, dateTo: String): [SprintVelocity!]!

    """Session timeline for Gantt chart: session start/end, tokens, tool calls, subagents"""
    sessionTimeline(developer: String, dateFrom: String, dateTo: String): [SessionTimelineEntry!]!

    """Data health monitoring: row counts, last updated timestamps, recent activity per stream"""
    dataHealth: DataHealth!
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
    sessionId: String
    taskTitle: String
  }

  # ── Conversation Types ────────────────────────────────────────

  type ToolCallInfo {
    name: String!
    summary: String
  }

  type ConversationMessage {
    role: String!
    content: String
    timestamp: String
    toolCalls: [ToolCallInfo!]
  }

  type SessionConversation {
    sessionId: String!
    developer: String
    sprint: String
    taskNum: Int
    taskTitle: String
    startedAt: String
    endedAt: String
    model: String
    messages: [ConversationMessage!]!
  }

  # ── Analytics Types ─────────────────────────────────────────

  type SkillUsage {
    toolName: String!
    invocations: Int!
    sessions: Int!
    firstUsed: String
    lastUsed: String
  }

  type SkillTokenUsage {
    skillName: String
    sprint: String
    invocations: Int!
    totalInputTokens: Int!
    totalOutputTokens: Int!
    avgTokensPerCall: Float
  }

  type SkillVersionTokenUsage {
    skillName: String
    skillVersion: String
    invocations: Int!
    totalInputTokens: Int!
    totalOutputTokens: Int!
    avgTokensPerCall: Float
  }

  type SkillDuration {
    skillName: String
    sprint: String
    taskNum: Int
    seconds: Float
  }

  type SkillVersionDuration {
    skillName: String
    skillVersion: String
    invocations: Int!
    avgSeconds: Float
    minSeconds: Float
    maxSeconds: Float
  }

  type SkillPrecision {
    sprint: String
    taskNum: Int
    filesRead: Int!
    filesModified: Int!
    explorationRatio: Float
  }

  type SkillVersionPrecision {
    skillName: String
    skillVersion: String
    tasks: Int!
    avgExplorationRatio: Float
  }

  type LearningRate {
    owner: String!
    sprint: String!
    tasks: Int!
    avgBlowUpRatio: Float
  }

  type PhaseTimingDistribution {
    sprint: String
    taskNum: Int
    phase: String!
    seconds: Float!
    pctOfTotal: Float
  }

  type TokenEfficiency {
    sprint: String
    complexity: String
    tasks: Int!
    avgTokensPerTask: Float
  }

  type BlowUpFactor {
    sprint: String!
    taskNum: Int!
    title: String
    type: String
    complexity: String
    estimatedMinutes: Float
    actualMinutes: Float
    blowUpRatio: Float
    reversions: Int
    testingPosture: String
  }

  type EstimationAccuracy {
    owner: String!
    tasksWithEstimates: Int!
    avgEstimated: Float
    avgActual: Float
    blowUpRatio: Float
    avgErrorMinutes: Float
  }

  type EstimationAccuracyByType {
    type: String!
    tasks: Int!
    avgEstimated: Float
    avgActual: Float
    blowUpRatio: Float
  }

  type EstimationAccuracyByComplexity {
    complexity: String!
    tasks: Int!
    avgEstimated: Float
    avgActual: Float
    blowUpRatio: Float
  }

  type DeveloperQuality {
    owner: String!
    totalTasks: Int!
    totalReversions: Int!
    reversionsPerTask: Float
    aGrades: Int!
    aGradePct: Float
  }

  type AuditFindings {
    owner: String!
    fakeTestIncidents: Int!
    patternViolations: Int!
    belowAGrade: Int!
    totalReversions: Int!
    totalTasks: Int!
  }

  type ReversionHotspot {
    type: String
    complexity: String
    tasks: Int!
    totalReversions: Int!
    avgReversions: Float
    aGradeRate: Float
  }

  type SprintVelocity {
    sprint: String!
    completedTasks: Int!
    avgMinutesPerTask: Float
    totalMinutes: Float
  }

  type SessionTimelineEntry {
    sessionId: String!
    parentSessionId: String
    developer: String
    sprint: String
    taskNum: Int
    taskTitle: String
    skillName: String
    startedAt: String!
    endedAt: String
    durationMinutes: Float
    totalInputTokens: Int
    totalOutputTokens: Int
    toolCallCount: Int
    messageCount: Int
    model: String
    subagents: [SessionTimelineEntry!]!
  }

  type DataHealth {
    streams: [DataHealthStream!]!
    lastSessionEndedAt: String
  }

  type DataHealthStream {
    stream: String!
    count: Int!
    lastUpdated: String
    recentCount: Int!
  }
`;
