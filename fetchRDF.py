#!/usr/bin/env python3
"""
Fetch RDF descriptions for OSM resources returned by a SPARQL query
and store them in a single RDF file.

Requirements:
    pip install SPARQLWrapper rdflib

Usage:
    python fetch_osm_rdf.py
"""

from SPARQLWrapper import SPARQLWrapper, JSON
from rdflib import Graph, URIRef

# --- CONFIG ----------------------------------------------------------

# QLever / SPARQL endpoint URL
ENDPOINT_URL = "https://qlever.dev/osm-planet/sparql"

# Output file
OUTPUT_FILE = "osm.ttl"

# Base SPARQL query: we’ll plug the VALUES in below
BASE_QUERY = """
SELECT * WHERE {
  VALUES ?osmID { %s }
  ?osmID <http://www.opengis.net/ont/geosparql#hasGeometry> ?o .
  ?o <http://www.opengis.net/ont/geosparql#asWKT> ?t .
}
"""

# List of OSM URIs you want to start from
OSM_IDS = [
    "https://www.openstreetmap.org/node/11287250673",
    "https://www.openstreetmap.org/node/664092519",
    "https://www.openstreetmap.org/node/1996185459",
    "https://www.openstreetmap.org/node/915674609",
    "https://www.openstreetmap.org/node/9965537517",
    "https://www.openstreetmap.org/way/64083386",
    "https://www.openstreetmap.org/relation/8312159",
    "https://www.openstreetmap.org/relation/8312160",
    "https://www.openstreetmap.org/relation/9754835116",
    "https://www.openstreetmap.org/way/824227244"
    # add more if you like
]

# --------------------------------------------------------------------


def run_select_query(endpoint_url: str, query: str):
    """Run a SELECT query and return JSON bindings."""
    sparql = SPARQLWrapper(endpoint_url)
    sparql.setQuery(query)
    sparql.setReturnFormat(JSON)
    results = sparql.query().convert()
    return results["results"]["bindings"]


def get_resource_triples(endpoint_url: str, uri: str) -> Graph:
    """
    Fetch all triples with the URI as subject from the endpoint.
    You can extend this to also fetch where it is object if you like.
    """
    g = Graph()
    resource = URIRef(uri)

    # CONSTRUCT triples with this URI as subject
    construct_query = f"""
    CONSTRUCT {{
      <{uri}> ?p ?o .
    }} WHERE {{
      <{uri}> ?p ?o .
    }}
    """
    sparql = SPARQLWrapper(endpoint_url)
    sparql.setQuery(construct_query)
    sparql.setReturnFormat("turtle")
    sparql.addCustomHttpHeader("Accept", "text/turtle")

    data = sparql.query().convert().decode("utf-8")
    g.parse(data=data, format="turtle")

    return g


def main():
    # Build VALUES clause
    values_clause = " ".join(f"<{u}>" for u in OSM_IDS)
    query = BASE_QUERY % values_clause

    print("Running SELECT query…")
    bindings = run_select_query(ENDPOINT_URL, query)

    # Collect all URIs we want RDF for: osmID and geometry ?o
    uris = set()
    for b in bindings:
        if "osmID" in b and b["osmID"]["type"] == "uri":
            uris.add(b["osmID"]["value"])
        if "o" in b and b["o"]["type"] == "uri":
            uris.add(b["o"]["value"])

    print(f"Found {len(uris)} unique URIs to fetch RDF for.")

    merged_graph = Graph()

    for i, uri in enumerate(sorted(uris), start=1):
        print(f"[{i}/{len(uris)}] Fetching RDF for {uri} …")
        try:
            g = get_resource_triples(ENDPOINT_URL, uri)
            merged_graph += g
        except Exception as e:
            print(f"  !! Error fetching {uri}: {e}")

    print(f"Total triples collected: {len(merged_graph)}")
    print(f"Writing to {OUTPUT_FILE} …")
    merged_graph.serialize(destination=OUTPUT_FILE, format="turtle")
    print("Done.")


if __name__ == "__main__":
    main()
