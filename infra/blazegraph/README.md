# Blazegraph Notebooks Playground

An interactive JupyterLab‑based environment for learning and experimenting with Blazegraph graph databases.  
This repository provides hands‑on examples and tutorials for understanding graph database concepts through practical examples.

We use Blazegraph as a local stand‑in for **Amazon Neptune** (via its SPARQL REST API). This lets you practice SPARQL queries, graph modeling, and visualization without needing a cloud cluster.

---

## ✨ Features

- **Interactive Learning**: Jupyter notebooks with step‑by‑step tutorials
- **Blazegraph Integration**: Run a Blazegraph server locally in Docker
- **SPARQL Tutorials**: Learn querying through interactive examples
- **Sample Datasets**: Install example notebooks with pre‑loaded data
- **Docker Support**: One‑command containerized setup
- **Graph‑Notebook Magics**: Use `%%sparql`, `%%gremlin`, `%%oc` directly in notebooks

---

## 📋 Prerequisites

- [Python](https://www.python.org/) 3.9–3.11 & [uv](https://docs.astral.sh/uv/) (managed via [mise](https://mise.jdx.dev/) or venv/conda)
- [VS Code](https://code.visualstudio.com/) with **Python**, **Jupyter**, and **Mise VSCode** extensions
- Docker / Docker Compose

---

## 🛠 Environment Setup with mise + VS Code

We recommend using [mise](https://mise.jdx.dev/lang/python.html) to manage Python versions and virtual environments. This ensures reproducibility across machines and avoids conflicts with system Python.

### 1. Install mise
- **macOS/Linux**:
  ```bash
  curl https://mise.run | sh
  ```
- **Windows**:
  ```powershell
  winget install mise
  ```
- Verify:
  ```bash
  mise --version
  ```

### 2. Configure Python with mise
- Pin Python for this project:
  ```bash
  mise use python@3.11 uv@latest
  ```
  This creates a `mise.toml` file in your repo that ensures everyone uses the same Python version.

  Of course, we've already set this up for you!
  So just run:
  ```bash
  mise install --yes
  ```
  to install the correct Python version.
- Check:
  ```bash
  python -V
  ```
  should show `3.11.x`.

---

## 💻 VS Code Setup

1. **Install extensions**:
   - [Python](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
   - [Jupyter](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter)
   - [Mise VSCode](https://marketplace.visualstudio.com/items?itemName=hverlin.mise-vscode)

2. **Select interpreter**:
   - Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
   - Run **Python: Select Interpreter**.
   - Choose the `mise` Python you just set up.

3. **Kernel registration**:
   - If your interpreter doesn’t show up, run:
     ```bash
     uv pip install ipykernel
     # OR the slower alternative:
     pip install ipykernel
     ```
   - Then restart VS Code and re‑select the kernel.

## 🚀 Getting Started

### 1. Clone the repository
```bash
git clone https://github.com/ThunderStrike/neptune-playground.git
cd neptune-playground
```

### 2. Set up Python environment
Using [mise](https://mise.jdx.dev/):
```bash
mise use python@3.11 uv@latest
uv pip install -r requirements.txt
# OR the slower alternative:
pip install -r requirements.txt

# Install graph-notebook IPython profile
python -m graph_notebook.ipython_profile.configure_ipython_profile
```

Or with venv:
```bash
python -m venv venv
source venv/bin/activate   # On Windows: venv\Scripts\activate
uv pip install -r requirements.txt
# OR the slower alternative:
pip install -r requirements.txt

# Install graph-notebook IPython profile
python -m graph_notebook.ipython_profile.configure_ipython_profile
```

> **Note**: The `uv pip install` installs all required packages (JupyterLab 4, graph‑notebook, widgets, etc.):
>  ```bash
>  uv pip install -r requirements.txt
>  # OR the slower alternative:
>  pip install -r requirements.txt
>  ```

### 3. Run Blazegraph in Docker
```bash
docker compose up --build -d
```

This exposes Blazegraph at: `http://localhost:9999/blazegraph/sparql`

### 4. Open in VS Code
- Open a `.ipynb` file from `./notebooks`
- Select your Python environment as the kernel
- Run the first cell to configure Blazegraph:

```python
%%graph_notebook_config
{
  "host": "localhost",
  "port": 9999,
  "ssl": false,
  "sparql": {
    "path": "blazegraph/sparql"
  }
}
```

> **Warning**: not all notebooks have this config, so you may need to manually copy and run the config code.

If the magic extentions cause issues, e.g. `UsageError: Cell magic '%%graph_notebook_config' not found.` run this command:

```bash
python -m graph_notebook.ipython_profile.configure_ipython_profile
```

If there are errors with the notebooks in general, try re-cloning the notebooks again:

```bash
python -m graph_notebook.notebooks.install --destination ./notebook_examples
```


---

## ⚠️ Widget Rendering in VS Code

Graph‑notebook uses **ipywidgets** for tables and graph visualizations. In VS Code, the Jupyter extension sometimes fails to render these widgets, leaving you with a blank cell.

### Workarounds:
- **Plain text/table mode**: Switch the output presentation to “Plain Text” or “Table” to see results.
- **Test widgets**: Run:
  ```python
  import ipywidgets as widgets
  widgets.IntSlider()
  ```
  If you don’t see a slider, widgets aren’t rendering.
- **Fixes**:
  - Ensure `ipywidgets>=8.0.0,<9.0.0` is installed (already in `requirements.txt`).
  - Update VS Code’s Python + Jupyter extensions to the latest versions.
  - If issues persist, run the same notebook in browser JupyterLab:
    ```bash
    jupyter lab
    ```
    Widgets render correctly there.

---

## 📦 Requirements

We follow the [official graph‑notebook requirements](https://github.com/aws/graph-notebook/blob/main/requirements.txt).  
Install with:

```bash
uv pip install -r requirements.txt
# OR the slower alternative:
pip install -r requirements.txt
```

The key packages include:

- `graph-notebook` (magics + visualization)
- `jupyterlab>=4.3.5,<5`
- `ipywidgets>=8.0.0,<9.0.0`
- `networkx`, `pandas`, `numpy`
- `SPARQLWrapper`, `rdflib`, `gremlinpython`, `neo4j`
- `boto3`, `botocore` (for Neptune compatibility)

See [requirements.txt](./requirements.txt) for the full list.

---

## 🌱 Seeding Data

### **Automatic Seeding (Docker Build)**

The Docker image is pre-seeded with comic data during build time:

1. **Narrative Ontology** (`narrative.ttl`) - Core classes and properties
2. **Recommendation Extensions** (`narrative-rec.ttl`) - Genre, Theme, Tone, Tag, User interactions, ranking features
3. **Comic Data** - Converted from JSON to RDF with the following enhancements:
   - **Genre instances** with `hasGenre` relationships
   - **Tone classification** (Dark, Comedic, Wholesome, Dramatic)
   - **Theme extraction** from genres (Heroism, Magic, Technology, Justice, etc.)
   - **Popularity scores** based on issue count and longevity
   - **Trending scores** for recent series
   - **Completion rates** for series analytics
   - **Format classes** for manifestations (SingleIssue, TradePaperback, etc.)
   - **Character tags** for themed discovery

To reseed with fresh data:
```bash
cd /workspaces/knowledge-grapht-platform/infra/blazegraph

# Stop and remove existing data
docker compose down
docker volume rm knowledge-grapht-neptune-data

# Rebuild with fresh seed
docker compose up --build -d
```

### **Manual Seeding**

You can also load data into a running Blazegraph instance:

1. **Interactive seeding**  
   In a notebook cell:
   ```python
   %seed
   ```
   Use the form to insert triples or load `.ttl/.rdf/.sparql` files.

2. **Example notebooks**  
   Many installed notebooks (e.g. *Air‑Routes*, *EPL*) walk you through loading datasets step by step.

3. **Scripts**  
   Use your own `.sparql` files with:
   ```bash
   curl -X POST http://localhost:9999/blazegraph/sparql \
        -H 'Content-Type: application/sparql-update' \
        --data-binary @[custom-sparql-filename].sparql
   ```

4. **Python Helper Scripts**
   ```bash
   # Load TTL ontology files
   python3 scripts/seed_helper.py load-ttl data/narrative.ttl
   python3 scripts/seed_helper.py load-ttl data/narrative-rec.ttl
   
   # Convert and load comic data (limit to 1000 issues)
   python3 scripts/comic_to_sparql.py data/comic_output.jsonl.zip -l 1000 -o comic_data.sparql
   python3 scripts/seed_helper.py load-sparql comic_data.sparql
   
   # Check statistics
   python3 scripts/seed_helper.py stats
   ```

### **Recommendation Features**

The seeded data now includes rich recommendation metadata from `narrative-rec.ttl`:

- **Content Descriptors**: Genre, Theme, Tone, Tags for filtering and discovery
- **Ranking Metrics**: Popularity, Trending, Completion Rate, Engagement scores
- **Format Classes**: Physical vs Digital, Issue types (Single, TPB, Hardcover, etc.)
- **Character Themes**: Auto-tagged based on character names and patterns
- **Series Relationships**: Franchise connections, Universe links

---

## 📂 Notebook Structure

1. **Getting Started**
   - Environment Setup
   - Basic Graph Concepts
   - Your First SPARQL Query

2. **Basic Operations**
   - CRUD Operations
   - Simple Queries
   - Graph Traversal

3. **Advanced Queries**
   - Complex SPARQL Patterns
   - Graph Analytics
   - Performance Optimization

4. **Use Cases**
   - Social Network Analysis
   - Knowledge Graphs
   - Data Integration Examples

---

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a PR.

---

## 📜 License

This project is licensed under the Apache‑2.0 License – see the LICENSE file for details.

---

## 📚 Resources

- [Graph‑Notebook README](https://github.com/aws/graph-notebook/blob/main/README.md)
- [Graph‑Notebook Requirements](https://github.com/aws/graph-notebook/blob/main/requirements.txt)
- [Blazegraph Documentation](https://github.com/blazegraph/database/)
- [SPARQL 1.1 Query Language](https://www.w3.org/TR/sparql11-query/)
- [Jupyter Documentation](https://jupyter.org/documentation)
