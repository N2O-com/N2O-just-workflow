export const timeTrackingTypeDefs = `#graphql
  extend type Query {
    """Current authenticated time tracking user"""
    timeTrackingMe: TimeTrackingUser

    """Time tracking workspace for the authenticated user"""
    timeTrackingWorkspace: TimeTrackingWorkspace

    """Team members from the time tracking provider"""
    timeTrackingMembers: [TimeTrackingMember!]!

    """Time entries from the Reports API (consolidated query)"""
    timeTrackingEntries(startDate: String!, endDate: String!): [TimeTrackingEntry!]!

    """Projects in the workspace"""
    timeTrackingProjects: [TimeTrackingProject!]!

    """Clients in the workspace"""
    timeTrackingClients: [TimeTrackingClient!]!

    """Tags in the workspace"""
    timeTrackingTags: [TimeTrackingTag!]!

    """Currently running timer (null if none)"""
    timeTrackingCurrentTimer: TimeTrackingCurrentTimer

    """Dashboard activity for the workspace"""
    timeTrackingDashboardActivity: [TimeTrackingDashboardActivity!]!

    """Pre-aggregated time tracking summary: hours per member with top entries. Use this instead of raw timeTrackingEntries for overview questions."""
    timeTrackingSummary(startDate: String!, endDate: String!): TimeTrackingSummaryResult!
  }

  extend type Mutation {
    """Update a team member's role or active status"""
    updateTimeTrackingMember(id: Int!, role: String, active: Boolean): TimeTrackingMember

    """Trigger a manual time tracking sync (admin only)"""
    triggerTimeTrackingSync: TogglSyncStatus!
  }

  type TogglSyncStatus {
    status: String!
    lastSyncAt: String
    entriesUpserted: Int
  }

  type TimeTrackingUser {
    id: Int!
    fullname: String
    email: String
  }

  type TimeTrackingWorkspace {
    id: Int!
    name: String
  }

  type TimeTrackingMember {
    id: Int!
    name: String!
    email: String
    role: String!
    active: Boolean!
  }

  type TimeTrackingProject {
    id: Int!
    name: String
    clientId: Int
    color: String
    active: Boolean
  }

  type TimeTrackingClient {
    id: Int!
    name: String
  }

  type TimeTrackingTag {
    id: Int!
    name: String
  }

  type TimeTrackingEntry {
    id: Int
    description: String
    start: String
    stop: String
    seconds: Int
    projectId: Int
    tagIds: [Int!]
    userId: Int
  }

  type TimeTrackingCurrentTimer {
    description: String
    start: String
    duration: Int
    projectId: Int
  }

  type TimeTrackingDashboardActivity {
    userId: Int
    description: String
    duration: Int
    projectId: Int
    start: String
    stop: String
  }

  type TimeTrackingSummaryResult {
    startDate: String!
    endDate: String!
    totalHours: Float!
    memberCount: Int!
    members: [TimeTrackingMemberSummary!]!
  }

  type TimeTrackingMemberSummary {
    userId: Int!
    name: String!
    role: String!
    totalHours: Float!
    dailyHours: [TimeTrackingDailyHours!]!
    topEntries: [TimeTrackingTopEntry!]!
  }

  type TimeTrackingDailyHours {
    date: String!
    hours: Float!
  }

  type TimeTrackingTopEntry {
    description: String!
    hours: Float!
    projectName: String
  }
`;
