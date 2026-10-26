const fs = require('fs');
const path = require('path');
const glob = require('glob');
const { Graphviz } = require('@hpcc-js/wasm');

const ROOT_DIR = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend', 'src');
const BACKEND_DIR = path.join(ROOT_DIR, 'blog-api');

const graph = {
    nodes: {}, // key: absolute path or external URL
    edges: [],
    circular_dependencies: [],
    isolated: []
};

// Node Types: FRONTEND_FILE, BACKEND_FILE, DATABASE, EXTERNAL_SERVICE
function addNode(id, type, label, group) {
    if (!graph.nodes[id]) {
        graph.nodes[id] = { id, type, label, group, inDegree: 0, outDegree: 0, refs: [] };
    }
}

function addEdge(source, target, type) {
    graph.edges.push({ source, target, type });
    if (graph.nodes[source]) graph.nodes[source].outDegree++;
    if (graph.nodes[target]) graph.nodes[target].inDegree++;
}

// 1. Scan Files
const frontendFiles = glob.sync('**/*.{js,jsx}', { cwd: FRONTEND_DIR, absolute: true, ignore: ['**/*.test.js', '**/setupTests.js'] });
const backendFiles = glob.sync('**/*.js', { cwd: BACKEND_DIR, absolute: true, ignore: ['**/node_modules/**', '**/__tests__/**'] });

// Populate nodes
frontendFiles.forEach(f => {
    let group = 'Frontend';
    if (f.includes('components')) group = 'Components';
    if (f.includes('hooks')) group = 'Hooks';
    addNode(f, 'FRONTEND_FILE', path.relative(FRONTEND_DIR, f), group);
});

backendFiles.forEach(f => {
    let group = 'Backend';
    if (f.includes('controllers')) group = 'Controllers';
    if (f.includes('routes')) group = 'Routes';
    if (f.includes('model')) group = 'Models';
    if (f.includes('services')) group = 'Services';
    if (f.includes('middlewares')) group = 'Middleware';
    addNode(f, 'BACKEND_FILE', path.relative(BACKEND_DIR, f), group);
});

// Database & Externals
addNode('MongoDB', 'DATABASE', 'MongoDB', 'Database');
addNode('Redis', 'EXTERNAL_SERVICE', 'Redis', 'External');
addNode('Qdrant', 'EXTERNAL_SERVICE', 'Qdrant (Vector DB)', 'External');

// Helper to resolve imports
function resolveImport(baseFile, importPath, type) {
    if (importPath.startsWith('.')) {
        let target = path.resolve(path.dirname(baseFile), importPath);
        if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
            target = path.join(target, 'index');
        }
        let exts = type === 'FRONTEND_FILE' ? ['.js', '.jsx'] : ['.js'];
        for (let ext of exts) {
            if (fs.existsSync(target + ext)) return target + ext;
        }
        if (fs.existsSync(target)) return target;
    }
    return null;
}

// Parse Frontend
frontendFiles.forEach(f => {
    const content = fs.readFileSync(f, 'utf8');
    
    // Imports
    const importRegex = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
        const target = resolveImport(f, match[1], 'FRONTEND_FILE');
        if (target && graph.nodes[target]) {
            addEdge(f, target, 'IMPORT');
        } else if (match[1] === 'axios') {
            addNode('axios', 'EXTERNAL_SERVICE', 'Axios', 'External');
            addEdge(f, 'axios', 'IMPORT');
        }
    }
    
    // API Calls (axios/fetch)
    const axiosRegex = /axios\.(get|post|put|delete)\(\s*[`'"](http:\/\/localhost:5000)?(\/[^`'"{?]+)/g;
    while ((match = axiosRegex.exec(content)) !== null) {
        const method = match[1].toUpperCase();
        let url = match[3];
        // clean url
        url = url.split('$')[0].split('?')[0];
        graph.nodes[f].refs.push({ type: 'HTTP_REQUEST', method, url });
    }
});

// Parse Backend
const backendRoutes = []; // { method, path, handlerFile }
backendFiles.forEach(f => {
    const content = fs.readFileSync(f, 'utf8');
    
    // Requires/Imports
    const reqRegex = /require\(['"]([^'"]+)['"]\)/g;
    let match;
    while ((match = reqRegex.exec(content)) !== null) {
        const target = resolveImport(f, match[1], 'BACKEND_FILE');
        if (target && graph.nodes[target]) {
            addEdge(f, target, 'IMPORT');
        }
    }
    const importRegex = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
    while ((match = importRegex.exec(content)) !== null) {
        const target = resolveImport(f, match[1], 'BACKEND_FILE');
        if (target && graph.nodes[target]) {
            addEdge(f, target, 'IMPORT');
        }
    }

    // Mongoose models
    if (content.includes('mongoose.model') || content.includes('mongoose.Schema')) {
        addEdge(f, 'MongoDB', 'DATABASE_RELATIONSHIP');
    }
    
    // Routes extraction (simplistic)
    // router.get('/path', ...) or app.post(...)
    const routeRegex = /(router|app)\.(get|post|put|delete)\(\s*['"]([^'"]+)['"]/g;
    while ((match = routeRegex.exec(content)) !== null) {
        let routePath = match[3];
        let method = match[2].toUpperCase();
        // Since we don't know the exact prefix yet without running it, we record it.
        backendRoutes.push({ file: f, method, path: routePath });
        graph.nodes[f].refs.push({ type: 'ROUTE_DEF', method, path: routePath });
    }
    
    // External Services usages
    if (content.includes('redis')) addEdge(f, 'Redis', 'EXTERNAL_API');
    if (content.includes('qdrant')) addEdge(f, 'Qdrant', 'EXTERNAL_API');
});

// Infer Frontend -> Backend API connections
// Since route prefixes (e.g. /auth, /blogs) are typically in server.js/app.js:
// We will simply do substring matching. If frontend calls /blogs/search, and a route is /search in blogs.js.
frontendFiles.forEach(f => {
    const node = graph.nodes[f];
    node.refs.forEach(ref => {
        if (ref.type === 'HTTP_REQUEST') {
            let matchedFile = null;
            let bestMatchLen = 0;
            // Trying to find the best matching backend route
            backendRoutes.forEach(br => {
                if (br.method === ref.method && ref.url.includes(br.path.replace(/\/$/, '')) && br.path.length > bestMatchLen) {
                    matchedFile = br.file;
                    bestMatchLen = br.path.length;
                }
            });
            if (matchedFile) {
                addEdge(f, matchedFile, 'HTTP_REQUEST');
            } else {
                // If it calls absolute url or standard prefix
                const urlLower = ref.url.toLowerCase();
                let found = false;
                if (urlLower.includes('/auth/')) {
                    const authRoutes = backendFiles.find(b => b.includes('auth.js') && b.includes('routes'));
                    if (authRoutes) { addEdge(f, authRoutes, 'HTTP_REQUEST'); found = true; }
                }
                if (!found && urlLower.includes('/blogs')) {
                    const blogRoutes = backendFiles.find(b => b.includes('blogs.js') && b.includes('routes'));
                    if (blogRoutes) { addEdge(f, blogRoutes, 'HTTP_REQUEST'); }
                }
            }
        }
    });
});

// Detect circular dependencies (DFS)
function findCycles() {
    let visited = new Set();
    let recStack = new Set();
    
    function dfs(nodeId, path) {
        if (recStack.has(nodeId)) {
            const idx = path.indexOf(nodeId);
            const cycle = path.slice(idx);
            graph.circular_dependencies.push(cycle);
            return;
        }
        if (visited.has(nodeId)) return;
        
        visited.add(nodeId);
        recStack.add(nodeId);
        
        const children = graph.edges.filter(e => e.source === nodeId).map(e => e.target);
        for (let child of children) {
            dfs(child, [...path, nodeId]);
        }
        recStack.delete(nodeId);
    }
    
    Object.keys(graph.nodes).forEach(n => {
        if (!visited.has(n)) dfs(n, []);
    });
}
findCycles();

// Identify isolated
Object.values(graph.nodes).forEach(n => {
    if (n.type === 'FRONTEND_FILE' || n.type === 'BACKEND_FILE') {
        if (n.inDegree === 0 && n.outDegree === 0) {
            if (!n.id.includes('index.js') && !n.id.includes('App.js') && !n.id.includes('server.js') && !n.id.includes('app.js')) {
                graph.isolated.push(n.id);
            }
        }
    }
});

fs.writeFileSync(path.join(ROOT_DIR, 'codebase-graph.json'), JSON.stringify(graph, null, 2));
console.log('Generated codebase-graph.json');

// Generate DOT String
let dot = 'digraph G {\n';
dot += '  rankdir=LR;\n';
dot += '  node [shape=box, style=filled, fontname="Helvetica"];\n';
dot += '  edge [fontname="Helvetica", fontsize=10];\n';

// Clusters
const frontendNodes = Object.values(graph.nodes).filter(n => n.type === 'FRONTEND_FILE');
const backendNodes = Object.values(graph.nodes).filter(n => n.type === 'BACKEND_FILE');
const externals = Object.values(graph.nodes).filter(n => ['DATABASE', 'EXTERNAL_SERVICE'].includes(n.type));

function createCluster(name, label, color, nodes) {
    let s = `  subgraph cluster_${name} {\n`;
    s += `    label="${label}";\n`;
    s += `    style=filled; color="${color}";\n`;
    
    // Group by group inside cluster
    const groups = {};
    nodes.forEach(n => {
        if (!groups[n.group]) groups[n.group] = [];
        groups[n.group].push(n);
    });
    
    let gidx = 0;
    for (let [gName, gNodes] of Object.entries(groups)) {
        s += `    subgraph cluster_${name}_${gidx++} {\n`;
        s += `      label="${gName}";\n`;
        s += `      style=dotted; color=gray;\n`;
        gNodes.forEach(n => {
            const shortName = path.basename(n.label);
            const fillcolor = n.inDegree + n.outDegree > 10 ? 'gold' : graph.isolated.includes(n.id) ? 'lightgray' : 'white';
            s += `      "${n.id}" [label="${shortName}\\n${n.group}", fillcolor="${fillcolor}"];\n`;
        });
        s += `    }\n`;
    }
    s += `  }\n`;
    return s;
}

dot += createCluster('frontend', 'FRONTEND (React)', '#e3f2fd', frontendNodes);
dot += createCluster('backend', 'BACKEND (Node/Express)', '#e8f5e9', backendNodes);

// Externals
dot += `  subgraph cluster_externals {\n`;
dot += `    label="EXTERNAL & DATA";\n`;
dot += `    style=filled; color="#fff3e0";\n`;
externals.forEach(n => {
    dot += `    "${n.id}" [label="${n.label}", shape=cylinder, fillcolor="#ffe0b2"];\n`;
});
dot += `  }\n`;

// Edges
graph.edges.forEach(e => {
    let color = 'black';
    let style = 'solid';
    if (e.type === 'HTTP_REQUEST') { color = 'blue'; style = 'bold'; }
    if (e.type === 'DATABASE_RELATIONSHIP') { color = 'green'; style = 'dashed'; }
    if (e.type === 'EXTERNAL_API') { color = 'orange'; style = 'dotted'; }
    
    // Avoid drawing too many useless edges
    dot += `  "${e.source}" -> "${e.target}" [color="${color}", style="${style}"];\n`;
});

// Add legend
dot += `
  subgraph cluster_legend {
    label="Legend";
    style=solid; color=black;
    "L1" [label="Module Dependency", shape=plaintext];
    "L2" [label="HTTP Request (Front -> Back)", shape=plaintext];
    "L3" [label="Database Relation", shape=plaintext];
    "L4" [label="External Service", shape=plaintext];
    
    "L1" -> "L1" [style=solid, color=black];
    "L2" -> "L2" [style=bold, color=blue];
    "L3" -> "L3" [style=dashed, color=green];
    "L4" -> "L4" [style=dotted, color=orange];
  }
`;

dot += '}\n';

// Render SVG
async function renderSVG() {
    const graphviz = await Graphviz.load();
    const svg = graphviz.layout(dot, 'svg', 'dot');
    fs.writeFileSync(path.join(ROOT_DIR, 'codebase-map.svg'), svg);
    console.log('Generated codebase-map.svg');
}
renderSVG().catch(console.error);
