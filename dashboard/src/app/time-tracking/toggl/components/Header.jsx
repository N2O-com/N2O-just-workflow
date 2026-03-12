import React, { useState } from 'react';
import { useMutation } from '@apollo/client/react';
import { styles } from '../styles';
import { formatDateKey } from '../utils/dates';
import { formatHours, timeAgo } from '../utils/time';
import { getNonOverlappingSeconds } from '../utils/layout';
import { TRIGGER_SYNC } from '../graphql/queries';

function SyncButton() {
  const [triggerSync, { loading: syncing }] = useMutation(TRIGGER_SYNC);
  const [lastResult, setLastResult] = useState(null);

  const handleSync = async () => {
    try {
      const { data } = await triggerSync();
      setLastResult(data?.triggerTimeTrackingSync ?? null);
    } catch {
      setLastResult({ status: 'error' });
    }
  };

  return (
    <button
      onClick={handleSync}
      disabled={syncing}
      style={{
        background: 'none', border: 'none', cursor: syncing ? 'wait' : 'pointer',
        padding: '2px 6px', color: '#8a8f9a', fontSize: 11, fontFamily: 'inherit',
        borderRadius: 4, display: 'flex', flexDirection: 'column', alignItems: 'center',
        opacity: syncing ? 0.5 : 1,
      }}
    >
      <span>{syncing ? 'Syncing...' : 'Sync'}</span>
      {lastResult && (
        <span style={{
          fontSize: 8, fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
          fontVariantNumeric: "tabular-nums", lineHeight: 1, marginTop: 1,
          color: lastResult.status === 'success' ? '#4caf50' : lastResult.status === 'error' ? '#ef5350' : '#5a5f6a',
        }}>
          {lastResult.status === 'success'
            ? `${lastResult.entriesUpserted ?? 0} entries`
            : lastResult.status}
        </span>
      )}
    </button>
  );
}

const HEADER_PRESET_LABELS = {
  today: 'Today', thisWeek: 'This Week', lastWeek: 'Last Week',
  thisMonth: 'This Month', thisQuarter: 'This Quarter', thisYear: 'This Year',
  last28: 'Last 28 Days', allTime: 'All Time',
};

export function Header({
  workspace, members, activeCount,
  dateRange, datePreset, customDateRange,
  filteredCalendarData, calendarDataWithTimer,
  last30Data, prev30Data,
  lastRefresh, loading, setLoading,
  refreshTimeData,
  onViewChange,
}) {
  const headerPeriodLabel = customDateRange ? 'Selected Range' : (HEADER_PRESET_LABELS[datePreset] || 'This Period');

  let rangeTotal = 0;
  {
    const cur = new Date(dateRange.start);
    cur.setHours(0, 0, 0, 0);
    const endDate = new Date(dateRange.end);
    endDate.setHours(23, 59, 59, 999);
    while (cur <= endDate) {
      const key = formatDateKey(cur);
      const dayEntries = filteredCalendarData[key];
      if (dayEntries) {
        for (const entries of Object.values(dayEntries)) {
          rangeTotal += getNonOverlappingSeconds(entries);
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
  }
  const thisWeekTotal = rangeTotal;

  const rangeDurationMs = dateRange.end.getTime() - dateRange.start.getTime();
  const prevRangeEnd = new Date(dateRange.start.getTime() - 1);
  const prevRangeStart = new Date(prevRangeEnd.getTime() - rangeDurationMs);
  let prevPeriodTotal = 0;
  {
    const cur = new Date(prevRangeStart);
    cur.setHours(0, 0, 0, 0);
    while (cur <= prevRangeEnd) {
      const key = formatDateKey(cur);
      const dayEntries = calendarDataWithTimer[key];
      if (dayEntries) {
        for (const entries of Object.values(dayEntries)) {
          prevPeriodTotal += getNonOverlappingSeconds(entries);
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
  }

  const headerNow = new Date();
  const isLiveRange = dateRange.end.getTime() >= headerNow.getTime() - 86400000;
  let prevPeriodAdjusted = prevPeriodTotal;
  if (isLiveRange && rangeDurationMs > 86400000) {
    const elapsed = headerNow.getTime() - dateRange.start.getTime();
    const fraction = Math.min(elapsed / rangeDurationMs, 1);
    prevPeriodAdjusted = prevPeriodTotal * fraction;
  }
  const weekChange = thisWeekTotal - prevPeriodAdjusted;
  const weekChangePercent = prevPeriodAdjusted > 0 ? ((weekChange / prevPeriodAdjusted) * 100).toFixed(0) : 0;

  const last30Total = Object.values(last30Data).reduce((sum, v) => sum + v, 0);
  const prev30Total = Object.values(prev30Data).reduce((sum, v) => sum + v, 0);
  const monthChange = last30Total - prev30Total;
  const monthChangePercent = prev30Total > 0 ? ((monthChange / prev30Total) * 100).toFixed(0) : 0;

  const avgHoursPerPerson = members.length > 0 ? (thisWeekTotal / members.length) / 3600 : 0;

  return (
    <div style={styles.header}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <div>
          <h1 style={styles.title}>{workspace?.name || 'Workspace'}</h1>
          <p style={styles.subtitle}>Team Time Tracking</p>
        </div>
        <div style={{ display: 'flex', gap: 1, marginLeft: 48 }}>
          <div style={{ ...styles.headerMetric, cursor: 'pointer' }} onClick={() => onViewChange('stats')}>
            <span style={styles.headerMetricLabel}>Members</span>
            <span style={styles.headerMetricVal}>{members.length}</span>
            <span style={{ fontSize: 10, color: activeCount > 0 ? '#4caf50' : '#5a5f6a' }}>{activeCount} active</span>
          </div>
          <div style={{ ...styles.headerMetric, cursor: 'pointer' }} onClick={() => onViewChange('stats')}>
            <span style={styles.headerMetricLabel}>{headerPeriodLabel}</span>
            <span style={styles.headerMetricVal}>{formatHours(thisWeekTotal)}h</span>
            <span style={{ fontSize: 10, color: weekChange >= 0 ? '#4caf50' : '#ef5350' }}>{weekChange >= 0 ? '+' : ''}{weekChangePercent}% vs prev</span>
          </div>
          <div style={{ ...styles.headerMetric, cursor: 'pointer' }} onClick={() => onViewChange('stats')}>
            <span style={styles.headerMetricLabel}>Avg/Person</span>
            <span style={styles.headerMetricVal}>{avgHoursPerPerson.toFixed(1)}h</span>
            <span style={{ fontSize: 10, color: '#5a5f6a' }}>{headerPeriodLabel.toLowerCase()}</span>
          </div>
          <div style={{ ...styles.headerMetric, cursor: 'pointer' }} onClick={() => onViewChange('stats')}>
            <span style={styles.headerMetricLabel}>Last 30d</span>
            <span style={styles.headerMetricVal}>{formatHours(last30Total)}h</span>
            <span style={{ fontSize: 10, color: monthChange >= 0 ? '#4caf50' : '#ef5350' }}>{monthChange >= 0 ? '+' : ''}{monthChangePercent}%</span>
          </div>
        </div>
      </div>
      <div style={styles.headerRight}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#1a1e2e', border: '1px solid #2a2f3a', borderRadius: 6,
          padding: '4px 8px',
        }}>
          <SyncButton />
          <div style={{ width: 1, height: 20, background: '#2a2f3a' }} />
          <button
            onClick={() => {
              setLoading(true);
              refreshTimeData();
            }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px',
              color: '#8a8f9a', fontSize: 11, fontFamily: 'inherit', borderRadius: 4,
              display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}
          >
            <span>Refresh</span>
            {lastRefresh && (
              <span style={{ fontSize: 8, color: '#5a5f6a', fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif", fontVariantNumeric: "tabular-nums", lineHeight: 1, marginTop: 1 }}>
                {timeAgo(lastRefresh.toISOString())}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
