import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  flowRate: number; // multiplier for flow calculation
  isOpen?: boolean; // toggle for gates/paths
}

interface Graph {
  nodes: Node[];
  edges: Edge[];
}

let graph: Graph = {
  nodes: [],
  edges: [],
};

let simulationActive = false;
let simulationInterval: NodeJS.Timeout | null = null;

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API to update graph
  app.post("/api/graph", (req, res) => {
    graph = req.body;
    res.json({ status: "ok", graph });
    broadcastGraph();
  });

  app.get("/api/graph", (req, res) => {
    res.json(graph);
  });

  app.post("/api/simulation/start", (req, res) => {
    simulationActive = true;
    startSimulation();
    res.json({ status: "started" });
  });

  app.post("/api/simulation/stop", (req, res) => {
    simulationActive = false;
    if (simulationInterval) clearInterval(simulationInterval);
    res.json({ status: "stopped" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    console.log("Client connected");
    ws.send(JSON.stringify({ type: "GRAPH_UPDATE", data: graph }));
    
    ws.on("message", (message) => {
      try {
        const payload = JSON.parse(message.toString());
        if (payload.type === "UPDATE_GRAPH") {
          graph = payload.data;
          broadcastGraph();
        }
      } catch (e) {
        console.error("Error parsing WS message", e);
      }
    });
  });

  function broadcastGraph() {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "GRAPH_UPDATE", data: graph }));
      }
    });
  }

  function startSimulation() {
    if (simulationInterval) clearInterval(simulationInterval);
    simulationInterval = setInterval(() => {
      if (!simulationActive) return;

      // Simple flow-based simulation
      const newNodes = [...graph.nodes.map(n => ({ ...n }))];
      const nodeStats = new Map<string, { inflow: number; outflow: number }>();
      newNodes.forEach(n => nodeStats.set(n.id, { inflow: 0, outflow: 0 }));
      
      // 1. Source nodes generate people
      newNodes.forEach(node => {
        if (node.type === "source") {
          const generated = Math.min(node.capacity - node.current, 50);
          node.current += generated;
          nodeStats.get(node.id)!.inflow += generated;
        }
      });

      const flows: { from: string; to: string; amount: number }[] = [];

      // 2. Flow between nodes
      graph.edges.forEach((edge) => {
        if (edge.isOpen === false) return; // Skip closed gates/edges

        const fromNode = newNodes.find((n) => n.id === edge.from);
        const toNode = newNodes.find((n) => n.id === edge.to);

        if (fromNode && toNode && fromNode.current > 0) {
          // Flow = min(edge_capacity, from_node_occupancy * flowRate, to_node_remaining_capacity)
          const potentialFlow = fromNode.current * (edge.flowRate / 100);
          const remainingToCapacity = toNode.capacity - toNode.current;
          const actualFlow = Math.min(edge.capacity, potentialFlow, remainingToCapacity);

          if (actualFlow > 0) {
            fromNode.current -= actualFlow;
            toNode.current += actualFlow;
            flows.push({ from: edge.from, to: edge.to, amount: actualFlow });
            
            nodeStats.get(fromNode.id)!.outflow += actualFlow;
            nodeStats.get(toNode.id)!.inflow += actualFlow;
          }
        }
      });

      // 3. Prediction Layer: Generate Alerts
      const alerts: any[] = [];
      newNodes.forEach(node => {
        const density = node.current / node.capacity;
        const stats = nodeStats.get(node.id)!;

        if (density > 0.8) {
          alerts.push({
            id: `alert-${node.id}-density`,
            type: 'danger',
            nodeId: node.id,
            title: `Critical Density at ${node.name}`,
            message: `Occupancy is at ${Math.round(density * 100)}%. High risk of crushing.`,
            suggestion: `IMMEDIATE ACTION: Close incoming gates and open emergency exits.`
          });
        } else if (stats.inflow > stats.outflow && density > 0.6) {
          alerts.push({
            id: `alert-${node.id}-bottleneck`,
            type: 'warning',
            nodeId: node.id,
            title: `Bottleneck Forming at ${node.name}`,
            message: `Inflow (${Math.round(stats.inflow)}) exceeds outflow (${Math.round(stats.outflow)}).`,
            suggestion: `Redirect incoming flow or increase outflow capacity.`
          });
        }
      });

      graph.nodes = newNodes;
      
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: "SIMULATION_UPDATE", data: { nodes: graph.nodes, flows, alerts } }));
        }
      });
    }, 500); // 500ms for smoother updates
  }
}

startServer();
