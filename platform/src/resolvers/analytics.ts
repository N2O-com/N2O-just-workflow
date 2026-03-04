import type { Context } from "../context.js";
import { queryAll } from "../db-adapter.js";

// Helper: build optional WHERE clause from filters
function whereClause(
  conditions: string[],
  params: any[]
): { where: string; params: any[] } {
  if (conditions.length === 0) return { where: "", params };
  return { where: `WHERE ${conditions.join(" AND ")}`, params };
}

export const analyticsResolvers = {
  Query: {
    // ── Skill Analytics ────────────────────────────────────

    skillUsage: async (
      _: any,
      args: { dateFrom?: string; dateTo?: string },
      ctx: Context
    ) => {
      const conditions: string[] = ["event_type = 'tool_call'"];
      const params: any[] = [];
      if (args.dateFrom) {
        conditions.push("timestamp >= ?");
        params.push(args.dateFrom);
      }
      if (args.dateTo) {
        conditions.push("timestamp <= ?");
        params.push(args.dateTo);
      }
      const { where } = whereClause(conditions, params);
      const rows = await queryAll(
        ctx.db,
        `SELECT tool_name,
            COUNT(*) as invocations,
            COUNT(DISTINCT session_id) as sessions,
            MIN(timestamp) as first_used,
            MAX(timestamp) as last_used
         FROM workflow_events
         ${where}
         GROUP BY tool_name
         ORDER BY invocations DESC`,
        params
      );
      return rows.map((row: any) => ({
        toolName: row.tool_name,
        invocations: parseInt(row.invocations),
        sessions: parseInt(row.sessions),
        firstUsed: row.first_used,
        lastUsed: row.last_used,
      }));
    },

    skillTokenUsage: async (
      _: any,
      args: { sprint?: string },
      ctx: Context
    ) => {
      const conditions: string[] = [];
      const params: any[] = [];
      if (args.sprint) {
        conditions.push("sprint = ?");
        params.push(args.sprint);
      }
      const { where } = whereClause(conditions, params);
      const rows = await queryAll(
        ctx.db,
        `SELECT * FROM skill_token_usage ${where} ORDER BY total_input_tokens + total_output_tokens DESC`,
        params
      );
      return rows.map((row: any) => ({
        skillName: row.skill_name,
        sprint: row.sprint,
        invocations: parseInt(row.invocations),
        totalInputTokens: parseInt(row.total_input_tokens),
        totalOutputTokens: parseInt(row.total_output_tokens),
        avgTokensPerCall: row.avg_tokens_per_call ? parseFloat(row.avg_tokens_per_call) : null,
      }));
    },

    skillVersionTokenUsage: async (
      _: any,
      args: { skillName?: string },
      ctx: Context
    ) => {
      const conditions: string[] = [];
      const params: any[] = [];
      if (args.skillName) {
        conditions.push("skill_name = ?");
        params.push(args.skillName);
      }
      const { where } = whereClause(conditions, params);
      const rows = await queryAll(
        ctx.db,
        `SELECT * FROM skill_version_token_usage ${where} ORDER BY skill_name, skill_version`,
        params
      );
      return rows.map((row: any) => ({
        skillName: row.skill_name,
        skillVersion: row.skill_version,
        invocations: parseInt(row.invocations),
        totalInputTokens: parseInt(row.total_input_tokens),
        totalOutputTokens: parseInt(row.total_output_tokens),
        avgTokensPerCall: row.avg_tokens_per_call ? parseFloat(row.avg_tokens_per_call) : null,
      }));
    },

    skillDuration: async (
      _: any,
      args: { sprint?: string },
      ctx: Context
    ) => {
      const conditions: string[] = [];
      const params: any[] = [];
      if (args.sprint) {
        conditions.push("sprint = ?");
        params.push(args.sprint);
      }
      const { where } = whereClause(conditions, params);
      const rows = await queryAll(
        ctx.db,
        `SELECT * FROM skill_duration ${where} ORDER BY skill_name`,
        params
      );
      return rows.map((row: any) => ({
        skillName: row.skill_name,
        sprint: row.sprint,
        taskNum: row.task_num,
        seconds: row.seconds ? parseFloat(row.seconds) : null,
      }));
    },

    skillVersionDuration: async (
      _: any,
      args: { skillName?: string },
      ctx: Context
    ) => {
      const conditions: string[] = [];
      const params: any[] = [];
      if (args.skillName) {
        conditions.push("skill_name = ?");
        params.push(args.skillName);
      }
      const { where } = whereClause(conditions, params);
      const rows = await queryAll(
        ctx.db,
        `SELECT * FROM skill_version_duration ${where} ORDER BY skill_name, skill_version`,
        params
      );
      return rows.map((row: any) => ({
        skillName: row.skill_name,
        skillVersion: row.skill_version,
        invocations: parseInt(row.invocations),
        avgSeconds: row.avg_seconds ? parseFloat(row.avg_seconds) : null,
        minSeconds: row.min_seconds ? parseFloat(row.min_seconds) : null,
        maxSeconds: row.max_seconds ? parseFloat(row.max_seconds) : null,
      }));
    },

    skillPrecision: async (
      _: any,
      args: { sprint?: string },
      ctx: Context
    ) => {
      const conditions: string[] = [];
      const params: any[] = [];
      if (args.sprint) {
        conditions.push("sprint = ?");
        params.push(args.sprint);
      }
      const { where } = whereClause(conditions, params);
      const rows = await queryAll(
        ctx.db,
        `SELECT * FROM skill_precision ${where} ORDER BY sprint, task_num`,
        params
      );
      return rows.map((row: any) => ({
        sprint: row.sprint,
        taskNum: row.task_num,
        filesRead: parseInt(row.files_read),
        filesModified: parseInt(row.files_modified),
        explorationRatio: row.exploration_ratio ? parseFloat(row.exploration_ratio) : null,
      }));
    },

    skillVersionPrecision: async (
      _: any,
      args: { skillName?: string },
      ctx: Context
    ) => {
      const conditions: string[] = [];
      const params: any[] = [];
      if (args.skillName) {
        conditions.push("skill_name = ?");
        params.push(args.skillName);
      }
      const { where } = whereClause(conditions, params);
      const rows = await queryAll(
        ctx.db,
        `SELECT * FROM skill_version_precision ${where} ORDER BY skill_name, skill_version`,
        params
      );
      return rows.map((row: any) => ({
        skillName: row.skill_name,
        skillVersion: row.skill_version,
        tasks: parseInt(row.tasks),
        avgExplorationRatio: row.avg_exploration_ratio ? parseFloat(row.avg_exploration_ratio) : null,
      }));
    },

    // ── Velocity Analytics ─────────────────────────────────

    developerLearningRate: async (
      _: any,
      args: { owner?: string },
      ctx: Context
    ) => {
      const conditions: string[] = [];
      const params: any[] = [];
      if (args.owner) {
        conditions.push("owner = ?");
        params.push(args.owner);
      }
      const { where } = whereClause(conditions, params);
      const rows = await queryAll(
        ctx.db,
        `SELECT * FROM developer_learning_rate ${where} ORDER BY owner, sprint`,
        params
      );
      return rows.map((row: any) => ({
        owner: row.owner,
        sprint: row.sprint,
        tasks: parseInt(row.tasks),
        avgBlowUpRatio: row.avg_blow_up_ratio ? parseFloat(row.avg_blow_up_ratio) : null,
      }));
    },

    phaseTimingDistribution: async (
      _: any,
      args: { sprint?: string },
      ctx: Context
    ) => {
      const conditions: string[] = [];
      const params: any[] = [];
      if (args.sprint) {
        conditions.push("sprint = ?");
        params.push(args.sprint);
      }
      const { where } = whereClause(conditions, params);
      const rows = await queryAll(
        ctx.db,
        `SELECT * FROM phase_time_distribution ${where} ORDER BY sprint, task_num, phase`,
        params
      );
      return rows.map((row: any) => ({
        sprint: row.sprint,
        taskNum: row.task_num,
        phase: row.phase,
        seconds: row.seconds ? parseFloat(row.seconds) : null,
        pctOfTotal: row.pct_of_total ? parseFloat(row.pct_of_total) : null,
      }));
    },

    tokenEfficiencyTrend: async (_: any, __: any, ctx: Context) => {
      const rows = await queryAll(
        ctx.db,
        "SELECT * FROM token_efficiency_trend ORDER BY sprint, complexity"
      );
      return rows.map((row: any) => ({
        sprint: row.sprint,
        complexity: row.complexity,
        tasks: parseInt(row.tasks),
        avgTokensPerTask: row.avg_tokens_per_task ? parseFloat(row.avg_tokens_per_task) : null,
      }));
    },

    blowUpFactors: async (
      _: any,
      args: { sprint?: string },
      ctx: Context
    ) => {
      const conditions: string[] = [];
      const params: any[] = [];
      if (args.sprint) {
        conditions.push("sprint = ?");
        params.push(args.sprint);
      }
      const { where } = whereClause(conditions, params);
      const rows = await queryAll(
        ctx.db,
        `SELECT * FROM blow_up_factors ${where} ORDER BY blow_up_ratio DESC`,
        params
      );
      return rows.map((row: any) => ({
        sprint: row.sprint,
        taskNum: row.task_num,
        title: row.title,
        type: row.type,
        complexity: row.complexity,
        estimatedMinutes: row.estimated_minutes ? parseFloat(row.estimated_minutes) : null,
        actualMinutes: row.actual_minutes ? parseFloat(row.actual_minutes) : null,
        blowUpRatio: row.blow_up_ratio ? parseFloat(row.blow_up_ratio) : null,
        reversions: row.reversions,
        testingPosture: row.testing_posture,
      }));
    },

    // ── Estimation Analytics ───────────────────────────────

    estimationAccuracy: async (
      _: any,
      args: { owner?: string; dateFrom?: string; dateTo?: string },
      ctx: Context
    ) => {
      const conditions: string[] = [
        "started_at IS NOT NULL",
        "completed_at IS NOT NULL",
        "estimated_minutes IS NOT NULL",
        "owner IS NOT NULL",
      ];
      const params: any[] = [];
      if (args.owner) {
        conditions.push("owner = ?");
        params.push(args.owner);
      }
      if (args.dateFrom) {
        conditions.push("completed_at >= ?");
        params.push(args.dateFrom);
      }
      if (args.dateTo) {
        conditions.push("completed_at <= ?");
        params.push(args.dateTo);
      }
      const { where } = whereClause(conditions, params);
      const rows = await queryAll(
        ctx.db,
        `SELECT
            owner,
            COUNT(*) as tasks_with_estimates,
            ROUND(AVG(estimated_minutes), 1) as avg_estimated,
            ROUND(AVG((julianday(completed_at) - julianday(started_at)) * 1440), 1) as avg_actual,
            ROUND(
                AVG((julianday(completed_at) - julianday(started_at)) * 1440) /
                NULLIF(AVG(estimated_minutes), 0),
            2) as blow_up_ratio,
            ROUND(AVG(ABS(
                (julianday(completed_at) - julianday(started_at)) * 1440 - estimated_minutes
            )), 1) as avg_error_minutes
         FROM tasks
         ${where}
         GROUP BY owner
         ORDER BY owner`,
        params
      );
      return rows.map((row: any) => ({
        owner: row.owner,
        tasksWithEstimates: parseInt(row.tasks_with_estimates),
        avgEstimated: row.avg_estimated ? parseFloat(row.avg_estimated) : null,
        avgActual: row.avg_actual ? parseFloat(row.avg_actual) : null,
        blowUpRatio: row.blow_up_ratio ? parseFloat(row.blow_up_ratio) : null,
        avgErrorMinutes: row.avg_error_minutes ? parseFloat(row.avg_error_minutes) : null,
      }));
    },

    estimationAccuracyByType: async (_: any, __: any, ctx: Context) => {
      const rows = await queryAll(
        ctx.db,
        "SELECT * FROM estimation_accuracy_by_type ORDER BY blow_up_ratio DESC"
      );
      return rows.map((row: any) => ({
        type: row.type,
        tasks: parseInt(row.tasks),
        avgEstimated: row.avg_estimated ? parseFloat(row.avg_estimated) : null,
        avgActual: row.avg_actual ? parseFloat(row.avg_actual) : null,
        blowUpRatio: row.blow_up_ratio ? parseFloat(row.blow_up_ratio) : null,
      }));
    },

    estimationAccuracyByComplexity: async (_: any, __: any, ctx: Context) => {
      const rows = await queryAll(
        ctx.db,
        "SELECT * FROM estimation_accuracy_by_complexity ORDER BY blow_up_ratio DESC"
      );
      return rows.map((row: any) => ({
        complexity: row.complexity,
        tasks: parseInt(row.tasks),
        avgEstimated: row.avg_estimated ? parseFloat(row.avg_estimated) : null,
        avgActual: row.avg_actual ? parseFloat(row.avg_actual) : null,
        blowUpRatio: row.blow_up_ratio ? parseFloat(row.blow_up_ratio) : null,
      }));
    },

    // ── Quality Analytics ──────────────────────────────────

    developerQuality: async (
      _: any,
      args: { owner?: string; dateFrom?: string; dateTo?: string },
      ctx: Context
    ) => {
      const conditions: string[] = ["owner IS NOT NULL", "status = 'green'"];
      const params: any[] = [];
      if (args.owner) {
        conditions.push("owner = ?");
        params.push(args.owner);
      }
      if (args.dateFrom) {
        conditions.push("completed_at >= ?");
        params.push(args.dateFrom);
      }
      if (args.dateTo) {
        conditions.push("completed_at <= ?");
        params.push(args.dateTo);
      }
      const { where } = whereClause(conditions, params);
      const rows = await queryAll(
        ctx.db,
        `SELECT
            owner,
            COUNT(*) as total_tasks,
            SUM(reversions) as total_reversions,
            ROUND(1.0 * SUM(reversions) / COUNT(*), 2) as reversions_per_task,
            SUM(CASE WHEN testing_posture = 'A' THEN 1 ELSE 0 END) as a_grades,
            ROUND(100.0 * SUM(CASE WHEN testing_posture = 'A' THEN 1 ELSE 0 END) / COUNT(*), 1) as a_grade_pct
         FROM tasks
         ${where}
         GROUP BY owner
         ORDER BY owner`,
        params
      );
      return rows.map((row: any) => ({
        owner: row.owner,
        totalTasks: parseInt(row.total_tasks),
        totalReversions: parseInt(row.total_reversions),
        reversionsPerTask: row.reversions_per_task ? parseFloat(row.reversions_per_task) : null,
        aGrades: parseInt(row.a_grades),
        aGradePct: row.a_grade_pct ? parseFloat(row.a_grade_pct) : null,
      }));
    },

    commonAuditFindings: async (
      _: any,
      args: { owner?: string; dateFrom?: string; dateTo?: string },
      ctx: Context
    ) => {
      const conditions: string[] = ["pattern_audited = 1", "owner IS NOT NULL"];
      const params: any[] = [];
      if (args.owner) {
        conditions.push("owner = ?");
        params.push(args.owner);
      }
      if (args.dateFrom) {
        conditions.push("completed_at >= ?");
        params.push(args.dateFrom);
      }
      if (args.dateTo) {
        conditions.push("completed_at <= ?");
        params.push(args.dateTo);
      }
      const { where } = whereClause(conditions, params);
      const rows = await queryAll(
        ctx.db,
        `SELECT owner,
            SUM(CASE WHEN pattern_audit_notes LIKE '%fake test%' THEN 1 ELSE 0 END) as fake_test_incidents,
            SUM(CASE WHEN pattern_audit_notes LIKE '%violation%' THEN 1 ELSE 0 END) as pattern_violations,
            SUM(CASE WHEN testing_posture != 'A' THEN 1 ELSE 0 END) as below_a_grade,
            SUM(reversions) as total_reversions,
            COUNT(*) as total_tasks
         FROM tasks
         ${where}
         GROUP BY owner
         ORDER BY owner`,
        params
      );
      return rows.map((row: any) => ({
        owner: row.owner,
        fakeTestIncidents: parseInt(row.fake_test_incidents),
        patternViolations: parseInt(row.pattern_violations),
        belowAGrade: parseInt(row.below_a_grade),
        totalReversions: parseInt(row.total_reversions),
        totalTasks: parseInt(row.total_tasks),
      }));
    },

    reversionHotspots: async (_: any, __: any, ctx: Context) => {
      const rows = await queryAll(
        ctx.db,
        "SELECT * FROM reversion_hotspots ORDER BY total_reversions DESC"
      );
      return rows.map((row: any) => ({
        type: row.type,
        complexity: row.complexity,
        tasks: parseInt(row.tasks),
        totalReversions: parseInt(row.total_reversions),
        avgReversions: row.avg_reversions ? parseFloat(row.avg_reversions) : null,
        aGradeRate: row.a_grade_rate ? parseFloat(row.a_grade_rate) : null,
      }));
    },

    // ── Sprint Analytics ───────────────────────────────────

    sprintVelocity: async (
      _: any,
      args: { sprint?: string; dateFrom?: string; dateTo?: string },
      ctx: Context
    ) => {
      const conditions: string[] = [
        "started_at IS NOT NULL",
        "completed_at IS NOT NULL",
      ];
      const params: any[] = [];
      if (args.sprint) {
        conditions.push("sprint = ?");
        params.push(args.sprint);
      }
      if (args.dateFrom) {
        conditions.push("completed_at >= ?");
        params.push(args.dateFrom);
      }
      if (args.dateTo) {
        conditions.push("completed_at <= ?");
        params.push(args.dateTo);
      }
      const { where } = whereClause(conditions, params);
      const rows = await queryAll(
        ctx.db,
        `SELECT
            sprint,
            COUNT(*) as completed_tasks,
            ROUND(AVG((julianday(completed_at) - julianday(started_at)) * 1440), 1) as avg_minutes_per_task,
            ROUND(SUM((julianday(completed_at) - julianday(started_at)) * 1440), 1) as total_minutes
         FROM tasks
         ${where}
         GROUP BY sprint
         ORDER BY sprint`,
        params
      );
      return rows.map((row: any) => ({
        sprint: row.sprint,
        completedTasks: parseInt(row.completed_tasks),
        avgMinutesPerTask: row.avg_minutes_per_task ? parseFloat(row.avg_minutes_per_task) : null,
        totalMinutes: row.total_minutes ? parseFloat(row.total_minutes) : null,
      }));
    },

    // ── Session Timeline ───────────────────────────────────

    sessionTimeline: async (
      _: any,
      args: { developer?: string; dateFrom?: string; dateTo?: string },
      ctx: Context
    ) => {
      const conditions: string[] = [];
      const params: any[] = [];

      if (args.developer) {
        conditions.push("t.owner = ?");
        params.push(args.developer);
      }
      if (args.dateFrom) {
        conditions.push("tr.started_at >= ?");
        params.push(args.dateFrom);
      }
      if (args.dateTo) {
        conditions.push("tr.started_at <= ?");
        params.push(args.dateTo);
      }

      const baseConditions = [
        "tr.parent_session_id IS NULL",
        "tr.started_at IS NOT NULL",
      ];
      const allConditions = [...baseConditions, ...conditions];
      const fullWhere = `WHERE ${allConditions.join(" AND ")}`;

      const primarySessions = await queryAll(
        ctx.db,
        `SELECT DISTINCT ON (tr.session_id)
                tr.*, t.owner as developer, t.title as task_title,
                we.skill_name
         FROM transcripts tr
         LEFT JOIN tasks t ON tr.sprint = t.sprint AND tr.task_num = t.task_num
         LEFT JOIN (
           SELECT session_id, skill_name
           FROM workflow_events
           WHERE event_type = 'skill_invoked'
           GROUP BY session_id, skill_name
         ) we ON we.session_id = tr.session_id
         ${fullWhere}
         ORDER BY tr.session_id, tr.started_at DESC`,
        params
      );

      const allChildren = await queryAll(
        ctx.db,
        `SELECT DISTINCT ON (tr.session_id)
                tr.*, t.owner as developer, t.title as task_title
         FROM transcripts tr
         LEFT JOIN tasks t ON tr.sprint = t.sprint AND tr.task_num = t.task_num
         WHERE tr.parent_session_id IS NOT NULL AND tr.started_at IS NOT NULL
         ORDER BY tr.session_id, tr.started_at`
      );

      const childrenByParent = new Map<string, any[]>();
      for (const child of allChildren) {
        const parentId = child.parent_session_id;
        if (!childrenByParent.has(parentId)) {
          childrenByParent.set(parentId, []);
        }
        childrenByParent.get(parentId)!.push(child);
      }

      return primarySessions.map((row: any) =>
        mapSessionEntry(row, childrenByParent)
      );
    },
  },
};

function mapSessionEntry(
  row: any,
  childrenByParent: Map<string, any[]>
): any {
  const durationMinutes =
    row.started_at && row.ended_at
      ? (new Date(row.ended_at).getTime() -
          new Date(row.started_at).getTime()) /
        60000
      : null;

  const children = childrenByParent.get(row.session_id) ?? [];

  return {
    sessionId: row.session_id,
    parentSessionId: row.parent_session_id ?? null,
    developer: row.developer ?? null,
    sprint: row.sprint,
    taskNum: row.task_num,
    taskTitle: row.task_title ?? null,
    skillName: row.skill_name ?? null,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMinutes,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    toolCallCount: row.tool_call_count,
    messageCount: row.message_count,
    model: row.model,
    subagents: children.map((child: any) =>
      mapSessionEntry(child, childrenByParent)
    ),
  };
}
