import React from 'react';
import { Flex, Text, Box } from '@radix-ui/themes';

interface UsageBarProps {
  label?: string;
  value: number;        // 0-100 percentage (or actual value if max specified)
  max?: number;         // defaults to 100
  compact?: boolean;    // compact mode for tables (6px bar)
  showValue?: boolean;
  showLabel?: boolean;  // show/hide the label text (alias compatibility)
  height?: number;
  formatValue?: (value: number, max: number) => string;
}

function getLoadLevel(val: number): 'normal' | 'warm' | 'hot' {
  if (val >= 80) return 'hot';
  if (val >= 60) return 'warm';
  return 'normal';
}

function getBarGradient(level: 'normal' | 'warm' | 'hot'): string {
  if (level === 'hot') return 'var(--monitor-load-hot, linear-gradient(90deg, var(--amber-6), var(--red-9)))';
  if (level === 'warm') return 'var(--monitor-load-warm, linear-gradient(90deg, var(--green-6), var(--amber-9)))';
  return 'var(--monitor-load-cool, linear-gradient(90deg, var(--green-5), var(--green-9)))';
}

function getBarGlow(level: 'normal' | 'warm' | 'hot'): string {
  if (level === 'hot') return '0 0 10px color-mix(in srgb, var(--monitor-danger, #ef4444) 34%, transparent)';
  if (level === 'warm') return '0 0 9px color-mix(in srgb, var(--monitor-warning, #f59e0b) 30%, transparent)';
  return '0 0 8px color-mix(in srgb, var(--monitor-success, #22c55e) 26%, transparent)';
}

export default function UsageBar({
  label,
  value,
  max = 100,
  compact = false,
  showValue = true,
  showLabel = true,
  height,
  formatValue,
}: UsageBarProps) {
  const pct = Math.min(Math.max(value, 0) / Math.max(max, 1) * 100, 100);
  const loadLevel = getLoadLevel(pct);
  const barGradient = getBarGradient(loadLevel);
  const barGlow = getBarGlow(loadLevel);
  const barH = height || (compact ? 6 : 8);
  const progressFillStyle = {
    '--usage-progress-background-size': `${10000 / Math.max(pct, 1)}% 100%`,
    height: '100%',
    background: `var(--monitor-resource-progress-gradient, ${barGradient})`,
    backgroundSize: 'var(--monitor-resource-progress-background-size, 100% 100%)',
    backgroundPosition: 'left center',
    borderRadius: '999px',
    width: '100%',
    transform: `scaleX(${pct / 100})`,
    boxShadow: barGlow,
  } as React.CSSProperties;

  const displayValue = formatValue
    ? formatValue(value, max)
    : `${pct.toFixed(pct < 10 ? 1 : 0)}%`;

  if (compact) {
    return (
      <Box style={{ width: '100%' }}>
        <Box style={{
          width: '100%', height: `${barH}px`,
          background: 'color-mix(in srgb, var(--monitor-ring-track, var(--gray-5)) 72%, transparent)', borderRadius: '999px',
          overflow: 'hidden', marginBottom: '2px',
          boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--monitor-border, var(--gray-5)) 55%, transparent)',
        }}>
          <div className="usage-bar-fill" style={progressFillStyle} />
        </Box>
        {showValue && (
          <label color="gray" style={{ fontSize: '0.75rem', color: 'var(--gray-11)' }}>
            {displayValue}
          </label>
        )}
      </Box>
    );
  }

  return (
    <Flex direction="column" gap="1" style={{ width: '100%' }}>
      <Flex justify="between" align="center">
        {label && showLabel && <Text size="2" color="gray">{label}</Text>}
        {showValue && showLabel && <Text size="2" weight="medium">{displayValue}</Text>}
      </Flex>
      <Box style={{
        width: '100%', height: `${barH}px`,
        background: 'color-mix(in srgb, var(--monitor-ring-track, var(--gray-5)) 72%, transparent)', borderRadius: '999px',
        overflow: 'hidden',
        boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--monitor-border, var(--gray-5)) 55%, transparent)',
      }}>
        <div className="usage-bar-fill" style={progressFillStyle} />
      </Box>
    </Flex>
  );
}
