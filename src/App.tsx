import React, { useState, useEffect, useRef, useMemo } from "react";
import { Stage, Layer, Image as KonvaImage, Circle, Line, Text, Group } from "react-konva";
import useImage from "use-image";
import { 
  Upload, 
  Plus, 
  Play, 
  Square, 
  Save, 
  Settings2, 
  Activity, 
  AlertTriangle, 
  Zap, 
  MousePointer2, 
  Move, 
  Trash2,
  Layers
} from "lucide-react";
import { cn } from "./lib/utils";

// --- Types ---
interface Node {
  id: string;
  name: string;
  type: "normal" | "source";
  capacity: number;
  current: number;
  x: number;
  y: number;
}

interface Edge {
  id: string;
  from: string;
  to: string;
  capacity: number;
  flowRate: number; // percentage of from occupancy that flows per step
  isOpen?: boolean;
}

interface Alert {
  id: string;
  type: 'danger' | 'warning';
  nodeId: string;
  title: string;
  message: string;
  suggestion: string;
}

interface Graph {
  nodes: Node[];
  edges: Edge[];
}

interface Particle {
  id: string;
  edgeId: string;
  progress: number; // 0 to 1
  amount: number;
}

// --- App Component ---
export default function App() {
  const [view, setView] = useState<"edit" | "simulate">("edit");
  const [blueprintUrl, setBlueprintUrl] = useState<string | null>(null);
  const [image] = useImage(blueprintUrl || "");
  
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  
  const [isDrawingEdge, setIsDrawingEdge] = useState(false);
  const [edgeStartNode, setEdgeStartNode] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  
  const [simulationActive, setSimulationActive] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  
  const ws = useRef<WebSocket | null>(null);
  const stageRef = useRef<any>(null);

  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  // --- WebSocket Setup ---
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const socket = new WebSocket(`${protocol}//${host}`);
    ws.current = socket;

    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === "GRAPH_UPDATE") {
        setNodes(payload.data.nodes);
        setEdges(payload.data.edges);
      } else if (payload.type === "SIMULATION_UPDATE") {
        setNodes(payload.data.nodes);
        setAlerts(payload.data.alerts || []);
        // Create particles for visual flow
        const newParticles: Particle[] = [];
        payload.data.flows.forEach((f: any) => {
          const edge = edgesRef.current.find(e => e.from === f.from && e.to === f.to);
          if (edge) {
            // Create multiple particles per flow for better visual
            const count = Math.min(Math.ceil(f.amount / 5), 10);
            for (let i = 0; i < count; i++) {
              newParticles.push({
                id: Math.random().toString(36).substr(2, 9),
                edgeId: edge.id,
                progress: -Math.random() * 0.2, // Staggered start
                amount: f.amount / count
              });
            }
          }
        });
        setParticles(prev => [...prev, ...newParticles]);
      }
    };

    return () => {
      socket.close();
    };
  }, []); // Empty dependency array for stability

  // --- Particle Animation ---
  useEffect(() => {
    if (!simulationActive) return;
    const interval = setInterval(() => {
      setParticles(prev => 
        prev
          .map(p => ({ ...p, progress: p.progress + 0.02 })) // Slower, smoother movement
          .filter(p => p.progress < 1)
      );
    }, 30);
    return () => clearInterval(interval);
  }, [simulationActive]);

  // --- Handlers ---
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setBlueprintUrl(url);
    }
  };

  const handleStageClick = (e: any) => {
    if (view !== "edit" || isDrawingEdge) return;
    
    // Check if clicked on empty space
    const clickedOnEmpty = e.target === e.target.getStage() || e.target.className === "Image";
    if (clickedOnEmpty) {
      const stage = e.target.getStage();
      const point = stage.getPointerPosition();
      
      const newNode: Node = {
        id: `node-${Date.now()}`,
        name: `Node ${nodes.length + 1}`,
        type: "normal",
        capacity: 1000,
        current: 0,
        x: point.x,
        y: point.y
      };
      
      const newNodes = [...nodes, newNode];
      setNodes(newNodes);
      updateBackend(newNodes, edges);
    }
  };

  const updateBackend = (n: Node[], e: Edge[]) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: "UPDATE_GRAPH", data: { nodes: n, edges: e } }));
    }
  };

  const startSimulation = async () => {
    await fetch("/api/simulation/start", { method: "POST" });
    setSimulationActive(true);
    setView("simulate");
  };

  const stopSimulation = async () => {
    await fetch("/api/simulation/stop", { method: "POST" });
    setSimulationActive(false);
    setParticles([]);
  };

  const handleNodeDragEnd = (id: string, e: any) => {
    const newNodes = nodes.map(n => 
      n.id === id ? { ...n, x: e.target.x(), y: e.target.y() } : n
    );
    setNodes(newNodes);
    updateBackend(newNodes, edges);
  };

  const handleNodeClick = (id: string, e: any) => {
    e.cancelBubble = true;
    const node = nodes.find(n => n.id === id);
    if (!node) return;

    if (view === "edit") {
      if (isDrawingEdge) {
        if (edgeStartNode && edgeStartNode !== id) {
          // Create edge
          const newEdge: Edge = {
            id: `edge-${Date.now()}`,
            from: edgeStartNode,
            to: id,
            capacity: 200,
            flowRate: 10,
            isOpen: true
          };
          const newEdges = [...edges, newEdge];
          setEdges(newEdges);
          updateBackend(nodes, newEdges);
        }
        setIsDrawingEdge(false);
        setEdgeStartNode(null);
      } else {
        setSelectedNode(node);
        setSelectedEdge(null);
      }
    }
  };

  const startDrawingEdge = (id: string) => {
    setIsDrawingEdge(true);
    setEdgeStartNode(id);
  };

  const deleteNode = (id: string) => {
    const newNodes = nodes.filter(n => n.id !== id);
    const newEdges = edges.filter(e => e.from !== id && e.to !== id);
    setNodes(newNodes);
    setEdges(newEdges);
    setSelectedNode(null);
    updateBackend(newNodes, newEdges);
  };

  const deleteEdge = (id: string) => {
    const newEdges = edges.filter(e => e.id !== id);
    setEdges(newEdges);
    setSelectedEdge(null);
    updateBackend(nodes, newEdges);
  };

  const toggleEdgeState = (id: string) => {
    const newEdges = edges.map(e => e.id === id ? { ...e, isOpen: e.isOpen === false ? true : false } : e);
    setEdges(newEdges);
    updateBackend(nodes, newEdges);
    if (selectedEdge?.id === id) {
      setSelectedEdge(newEdges.find(e => e.id === id) || null);
    }
  };

  const reverseEdge = (id: string) => {
    const newEdges = edges.map(e => e.id === id ? { ...e, from: e.to, to: e.from } : e);
    setEdges(newEdges);
    updateBackend(nodes, newEdges);
    if (selectedEdge?.id === id) {
      setSelectedEdge(newEdges.find(e => e.id === id) || null);
    }
  };

  // --- Render Helpers ---
  const getNodeColor = (node: Node) => {
    const ratio = node.current / node.capacity;
    if (ratio > 0.9) return "#ef4444"; // Red
    if (ratio > 0.7) return "#f59e0b"; // Yellow
    return "#22c55e"; // Green
  };

  const handleMouseMove = (e: any) => {
    if (isDrawingEdge) {
      const stage = e.target.getStage();
      const point = stage.getPointerPosition();
      setMousePos(point);
    }
  };

  return (
    <div className="flex h-screen bg-background text-on-surface font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-80 bg-surface border-r border-outline-variant flex flex-col p-6 z-10 shadow-xl">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-primary flex items-center justify-center rounded-lg shadow-lg shadow-primary/20">
            <Activity className="text-on-primary w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold font-headline tracking-tight text-primary">CrowdTwin</h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Simulation Engine</p>
          </div>
        </div>

        <div className="flex gap-2 mb-6">
          <button 
            onClick={() => setView("edit")}
            className={cn(
              "flex-1 py-2 px-4 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all",
              view === "edit" ? "bg-primary text-on-primary shadow-lg shadow-primary/20" : "bg-surface-container-high text-slate-400 hover:bg-surface-container-highest"
            )}
          >
            <MousePointer2 className="w-4 h-4" />
            Editor
          </button>
          <button 
            onClick={() => setView("simulate")}
            className={cn(
              "flex-1 py-2 px-4 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all",
              view === "simulate" ? "bg-primary text-on-primary shadow-lg shadow-primary/20" : "bg-surface-container-high text-slate-400 hover:bg-surface-container-highest"
            )}
          >
            <Layers className="w-4 h-4" />
            Live
          </button>
        </div>

        <div className="space-y-6 flex-1 overflow-y-auto no-scrollbar">
          {!blueprintUrl && (
            <div className="p-6 border-2 border-dashed border-outline-variant rounded-xl text-center">
              <Upload className="w-8 h-8 mx-auto mb-4 text-slate-500" />
              <p className="text-xs text-slate-400 mb-4">Upload a venue blueprint to start</p>
              <label className="bg-primary text-on-primary px-4 py-2 rounded-lg text-xs font-bold cursor-pointer hover:brightness-110 transition-all">
                Choose File
                <input type="file" className="hidden" onChange={handleImageUpload} accept="image/*" />
              </label>
            </div>
          )}

          {selectedNode && (
            <div className="bg-surface-container-high p-5 rounded-xl border border-outline-variant/30 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest text-primary">Node Settings</h3>
                <button onClick={() => deleteNode(selectedNode.id)} className="text-error hover:bg-error/10 p-1 rounded">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-bold">Type</label>
                  <select 
                    className="w-full bg-surface-container-highest border-0 border-b border-outline-variant focus:border-primary focus:ring-0 text-sm py-1 px-0"
                    value={selectedNode.type}
                    onChange={(e) => {
                      const val = e.target.value as "normal" | "source";
                      const newNodes = nodes.map(n => n.id === selectedNode.id ? { ...n, type: val } : n);
                      setNodes(newNodes);
                      updateBackend(newNodes, edges);
                      setSelectedNode({ ...selectedNode, type: val });
                    }}
                  >
                    <option value="normal">Normal Node</option>
                    <option value="source">Crowd Source (Generator)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-bold">Name</label>
                  <input 
                    className="w-full bg-surface-container-highest border-0 border-b border-outline-variant focus:border-primary focus:ring-0 text-sm py-1 px-0"
                    value={selectedNode.name}
                    onChange={(e) => {
                      const newNodes = nodes.map(n => n.id === selectedNode.id ? { ...n, name: e.target.value } : n);
                      setNodes(newNodes);
                      updateBackend(newNodes, edges);
                      setSelectedNode({ ...selectedNode, name: e.target.value });
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-bold">Capacity</label>
                  <input 
                    type="number"
                    className="w-full bg-surface-container-highest border-0 border-b border-outline-variant focus:border-primary focus:ring-0 text-sm py-1 px-0"
                    value={selectedNode.capacity}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      const newNodes = nodes.map(n => n.id === selectedNode.id ? { ...n, capacity: val } : n);
                      setNodes(newNodes);
                      updateBackend(newNodes, edges);
                      setSelectedNode({ ...selectedNode, capacity: val });
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-bold">Current Occupancy</label>
                  <input 
                    type="number"
                    className="w-full bg-surface-container-highest border-0 border-b border-outline-variant focus:border-primary focus:ring-0 text-sm py-1 px-0"
                    value={selectedNode.current}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      const newNodes = nodes.map(n => n.id === selectedNode.id ? { ...n, current: val } : n);
                      setNodes(newNodes);
                      updateBackend(newNodes, edges);
                      setSelectedNode({ ...selectedNode, current: val });
                    }}
                  />
                </div>
                <button 
                  onClick={() => startDrawingEdge(selectedNode.id)}
                  className={cn(
                    "w-full py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all",
                    isDrawingEdge && edgeStartNode === selectedNode.id 
                      ? "bg-primary text-on-primary" 
                      : "bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
                  )}
                >
                  {isDrawingEdge && edgeStartNode === selectedNode.id ? "Click Target Node" : "Connect to Node"}
                </button>
              </div>
            </div>
          )}

          {selectedEdge && (
            <div className="bg-surface-container-high p-5 rounded-xl border border-outline-variant/30 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest text-secondary">Edge Settings</h3>
                <button onClick={() => deleteEdge(selectedEdge.id)} className="text-error hover:bg-error/10 p-1 rounded">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-bold">Max Flow Capacity</label>
                  <input 
                    type="number"
                    className="w-full bg-surface-container-highest border-0 border-b border-outline-variant focus:border-primary focus:ring-0 text-sm py-1 px-0"
                    value={selectedEdge.capacity}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      const newEdges = edges.map(edge => edge.id === selectedEdge.id ? { ...edge, capacity: val } : edge);
                      setEdges(newEdges);
                      updateBackend(nodes, newEdges);
                      setSelectedEdge({ ...selectedEdge, capacity: val });
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase font-bold">Flow Rate (%)</label>
                  <input 
                    type="number"
                    className="w-full bg-surface-container-highest border-0 border-b border-outline-variant focus:border-primary focus:ring-0 text-sm py-1 px-0"
                    value={selectedEdge.flowRate}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      const newEdges = edges.map(edge => edge.id === selectedEdge.id ? { ...edge, flowRate: val } : edge);
                      setEdges(newEdges);
                      updateBackend(nodes, newEdges);
                      setSelectedEdge({ ...selectedEdge, flowRate: val });
                    }}
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button 
                    onClick={() => reverseEdge(selectedEdge.id)}
                    className="flex-1 py-2 bg-surface-container-highest text-slate-300 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-surface-container-highest/80 transition-all"
                  >
                    Reverse Flow
                  </button>
                  <button 
                    onClick={() => toggleEdgeState(selectedEdge.id)}
                    className={cn(
                      "flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all",
                      selectedEdge.isOpen === false 
                        ? "bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
                        : "bg-error/10 text-error border border-error/30 hover:bg-error/20"
                    )}
                  >
                    {selectedEdge.isOpen === false ? "Open Gate" : "Close Gate"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-auto pt-6 border-t border-outline-variant/30">
          {!simulationActive ? (
            <button 
              onClick={startSimulation}
              disabled={nodes.length < 2}
              className="w-full py-4 bg-primary text-on-primary rounded-xl font-bold uppercase tracking-widest text-sm shadow-lg shadow-primary/20 hover:brightness-110 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
            >
              <Play className="w-5 h-5 fill-current" />
              Start Simulation
            </button>
          ) : (
            <button 
              onClick={stopSimulation}
              className="w-full py-4 bg-error text-on-error rounded-xl font-bold uppercase tracking-widest text-sm shadow-lg shadow-error/20 hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-3"
            >
              <Square className="w-5 h-5 fill-current" />
              Stop Simulation
            </button>
          )}
        </div>
      </aside>

      {/* Canvas Area */}
      <main className="flex-1 relative bg-slate-950 overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-20 pointer-events-none" />
        
        <Stage 
          width={window.innerWidth - 320} 
          height={window.innerHeight}
          onClick={handleStageClick}
          onMouseMove={handleMouseMove}
          ref={stageRef}
        >
          <Layer>
            {image && (
              <KonvaImage 
                image={image} 
                width={window.innerWidth - 320} 
                height={window.innerHeight}
                opacity={view === "simulate" ? 0.3 : 0.6}
              />
            )}

            {/* Heatmap Layer (Simulated with blurred circles) */}
            {view === "simulate" && nodes.map(node => {
              const ratio = node.current / node.capacity;
              if (ratio < 0.3) return null;
              return (
                <Circle 
                  key={`heat-${node.id}`}
                  x={node.x}
                  y={node.y}
                  radius={50 + ratio * 100}
                  fillRadialGradientStartPoint={{ x: 0, y: 0 }}
                  fillRadialGradientStartRadius={0}
                  fillRadialGradientEndPoint={{ x: 0, y: 0 }}
                  fillRadialGradientEndRadius={50 + ratio * 100}
                  fillRadialGradientColorStops={[
                    0, ratio > 0.9 ? "rgba(239, 68, 68, 0.4)" : ratio > 0.7 ? "rgba(245, 158, 11, 0.3)" : "rgba(34, 197, 94, 0.2)",
                    1, "transparent"
                  ]}
                />
              );
            })}

            {/* Edges */}
            {edges.map(edge => {
              const from = nodes.find(n => n.id === edge.from);
              const to = nodes.find(n => n.id === edge.to);
              if (!from || !to) return null;
              
              const isClosed = edge.isOpen === false;
              const strokeColor = isClosed ? "#ef4444" : (selectedEdge?.id === edge.id ? "#75ff9e" : "#3b4a3d");

              return (
                <Group key={edge.id} onClick={() => { setSelectedEdge(edge); setSelectedNode(null); }}>
                  <Line 
                    points={[from.x, from.y, to.x, to.y]}
                    stroke={strokeColor}
                    strokeWidth={isClosed ? 2 : 4}
                    dash={isClosed ? [10, 10] : []}
                    opacity={isClosed ? 0.4 : 0.6}
                  />
                  {/* Direction Arrow Indicator */}
                  {!isClosed && (
                    <Circle 
                      x={from.x + (to.x - from.x) * 0.5}
                      y={from.y + (to.y - from.y) * 0.5}
                      radius={3}
                      fill={strokeColor}
                    />
                  )}
                </Group>
              );
            })}

            {/* Drawing Edge Line */}
            {isDrawingEdge && edgeStartNode && (
              <Line 
                points={[
                  nodes.find(n => n.id === edgeStartNode)?.x || 0,
                  nodes.find(n => n.id === edgeStartNode)?.y || 0,
                  mousePos.x,
                  mousePos.y
                ]}
                stroke="#75ff9e"
                strokeWidth={2}
                dash={[10, 5]}
              />
            )}

            {/* Particles (Movement Animation) */}
            {view === "simulate" && particles.map(p => {
              const edge = edges.find(e => e.id === p.edgeId);
              if (!edge) return null;
              const from = nodes.find(n => n.id === edge.from);
              const to = nodes.find(n => n.id === edge.to);
              if (!from || !to) return null;
              
              const x = from.x + (to.x - from.x) * Math.max(0, p.progress);
              const y = from.y + (to.y - from.y) * Math.max(0, p.progress);
              
              if (p.progress < 0) return null;

              return (
                <Circle 
                  key={p.id}
                  x={x}
                  y={y}
                  radius={1.5}
                  fill="#75ff9e"
                  shadowBlur={5}
                  shadowColor="#75ff9e"
                />
              );
            })}

            {/* Nodes */}
            {nodes.map(node => (
              <Group 
                key={node.id} 
                draggable={view === "edit"}
                onDragEnd={(e) => handleNodeDragEnd(node.id, e)}
                onClick={(e) => handleNodeClick(node.id, e)}
                x={node.x}
                y={node.y}
              >
                <Circle 
                  radius={selectedNode?.id === node.id ? 12 : 8}
                  fill={getNodeColor(node)}
                  stroke="#fff"
                  strokeWidth={selectedNode?.id === node.id ? 2 : 0}
                  shadowBlur={10}
                  shadowColor={getNodeColor(node)}
                />
                <Text 
                  text={node.name}
                  y={15}
                  x={-20}
                  fill="#fff"
                  fontSize={10}
                  fontStyle="bold"
                  align="center"
                  width={40}
                />
                {view === "simulate" && (
                  <Text 
                    text={`${Math.round((node.current / node.capacity) * 100)}%`}
                    y={-20}
                    x={-20}
                    fill={getNodeColor(node)}
                    fontSize={10}
                    fontStyle="bold"
                    align="center"
                    width={40}
                  />
                )}
              </Group>
            ))}
          </Layer>
        </Stage>

        {/* Floating Info */}
        <div className="absolute top-6 right-6 flex flex-col gap-4 z-20">
          <div className="bg-slate-900/80 backdrop-blur-md p-4 border border-outline-variant/30 rounded-xl shadow-2xl w-80">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="text-primary w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">System Status</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase">Nodes</span>
                <span className="text-lg font-bold text-white">{nodes.length}</span>
              </div>
              <div className="h-8 w-px bg-slate-800" />
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase">Edges</span>
                <span className="text-lg font-bold text-white">{edges.length}</span>
              </div>
              <div className="h-8 w-px bg-slate-800" />
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase">Total Crowd</span>
                <span className="text-lg font-bold text-primary">{Math.round(nodes.reduce((acc, n) => acc + n.current, 0))}</span>
              </div>
            </div>
          </div>

          {/* Alerts Panel */}
          {view === "simulate" && alerts.length > 0 && (
            <div className="flex flex-col gap-2">
              {alerts.map(alert => (
                <div 
                  key={alert.id} 
                  className={cn(
                    "p-4 rounded-xl shadow-2xl border backdrop-blur-md animate-in slide-in-from-right-4",
                    alert.type === 'danger' 
                      ? "bg-error/10 border-error/30 text-error" 
                      : "bg-secondary/10 border-secondary/30 text-secondary"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-widest mb-1">{alert.title}</h4>
                      <p className="text-sm text-slate-300 mb-2">{alert.message}</p>
                      <div className="bg-slate-950/50 p-2 rounded border border-white/10">
                        <p className="text-xs text-slate-400"><span className="font-bold text-white">AI Suggestion:</span> {alert.suggestion}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
