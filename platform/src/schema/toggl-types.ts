export const togglTypeDefs = `#graphql
  extend type Query {
    """Current authenticated Toggl user"""
    togglMe: TogglUser

    """Toggl workspace for the authenticated user"""
    togglWorkspace: TogglWorkspace

    """Team members from the toggl_members table"""
    togglMembers: [TogglMember!]!

    """Time entries from the Toggl Reports API (consolidated query)"""
    togglTimeEntries(startDate: String!, endDate: String!): [TogglTimeEntry!]!

    """Projects in the workspace"""
    togglProjects: [TogglProject!]!

    """Clients in the workspace"""
    togglClients: [TogglClient!]!

    """Tags in the workspace"""
    togglTags: [TogglTag!]!

    """Currently running timer (null if none)"""
    togglCurrentTimer: TogglCurrentTimer

    """Dashboard activity for the workspace"""
    togglDashboardActivity: [TogglDashboardActivity!]!
  }

  extend type Mutation {
    """Update a team member's role or active status"""
    updateTogglMember(id: Int!, role: String, active: Boolean): TogglMember
  }

  type TogglUser {
    id: Int!
    fullname: String
    email: String
  }

  type TogglWorkspace {
    id: Int!
    name: String
  }

  type TogglMember {
    id: Int!
    togglName: String!
    email: String
    role: String!
    active: Boolean!
  }

  type TogglProject {
    id: Int!
    name: String
    clientId: Int
    color: String
    active: Boolean
  }

  type TogglClient {
    id: Int!
    name: String
  }

  type TogglTag {
    id: Int!
    name: String
  }

  type TogglTimeEntry {
    id: Int
    description: String
    start: String
    stop: String
    seconds: Int
    projectId: Int
    tagIds: [Int!]
    userId: Int
  }

  type TogglCurrentTimer {
    description: String
    start: String
    duration: Int
    projectId: Int
  }

  type TogglDashboardActivity {
    userId: Int
    description: String
    duration: Int
    projectId: Int
    start: String
    stop: String
  }
`;
