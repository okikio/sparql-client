#!/usr/bin/env python3
"""Non-interactive helper for Docker auto-seeding"""

import sys
import requests
import time
import re

ENDPOINT = "http://localhost:9999/blazegraph/sparql"

def load_ttl(file_path):
    """Load a TTL file"""
    print(f"Loading {file_path}...")
    with open(file_path, 'rb') as f:
        data = f.read()
    
    response = requests.post(
        ENDPOINT,
        data=data,
        headers={'Content-Type': 'application/x-turtle'},
        timeout=300
    )
    
    if response.status_code in [200, 204]:
        print(f"✓ Loaded successfully")
        return True
    else:
        print(f"❌ Failed: {response.status_code}")
        return False

def load_sparql(file_path):
    """Load SPARQL file in chunks"""
    print(f"Loading {file_path}...")
    
    with open(file_path, 'r') as f:
        content = f.read()
    
    # Split by INSERT DATA blocks
    blocks = re.split(r'(?=INSERT DATA \{)', content)
    blocks = [b.strip() for b in blocks if b.strip() and b.strip().startswith('INSERT')]
    
    total = len(blocks)
    print(f"Found {total} blocks to load")
    success = 0
    
    for i, block in enumerate(blocks, 1):
        if i % 10 == 0:
            print(f"  Progress: {i}/{total}")
        
        try:
            response = requests.post(
                ENDPOINT,
                data=block.encode('utf-8'),
                headers={'Content-Type': 'application/sparql-update'},
                timeout=60
            )
            if response.status_code in [200, 204]:
                success += 1
        except Exception as e:
            print(f"  Warning: Block {i} failed: {e}")
    
    print(f"✓ Loaded {success}/{total} blocks")
    return success == total

def show_stats():
    """Show triple count"""
    query = "SELECT (COUNT(*) as ?count) WHERE { ?s ?p ?o }"
    response = requests.get(
        ENDPOINT,
        params={'query': query},
        headers={'Accept': 'application/sparql-results+json'},
        timeout=30
    )
    
    if response.status_code == 200:
        count = int(response.json()['results']['bindings'][0]['count']['value'])
        print(f"\n📊 Database contains {count:,} triples")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: seed_helper.py [load-ttl|load-sparql|stats] [file]")
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == "load-ttl":
        load_ttl(sys.argv[2])
    elif command == "load-sparql":
        load_sparql(sys.argv[2])
    elif command == "stats":
        show_stats()