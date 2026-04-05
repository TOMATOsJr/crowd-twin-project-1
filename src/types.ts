export type NodeType = 'gate' | 'zone' | 'corridor' | 'stairwell';

export interface Node {
  id: string;
  name: string;
  type: NodeType;
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  capacity: number;
  currentOccupancy: number;
  inflowRate: number; // people per minute
  outflowRate: number; // people per minute
}

export interface Edge {
  id: string;
  from: string;
  to: string;
  capacity: number;
  width: number; // meters
  status: 'nominal' | 'warning' | 'critical';
}

export interface Alert {
  id: string;
  type: 'critical' | 'warning';
  title: string;
  description: string;
  location: string;
  timestamp: string;
  zoneId: string;
}

export interface Recommendation {
  id: string;
  type: 'diversion' | 'optimization' | 'control';
  title: string;
  action: string;
  impact: string;
  nodeId: string;
}

export type AppView = 'simulation' | 'config' | 'alerts' | 'analytics';
