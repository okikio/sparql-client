#!/usr/bin/env python3
"""
Comic JSON to SPARQL converter for Narrative Graph Ontology
Streams large comic_output.json and generates SPARQL INSERT statements

Updated to utilize new ontology properties:
- Person: knownAs
- Org: legalName, orgType
- StoryWork: seriesName, sortName, volume, yearBegan, yearEnded, issueCount,
              seriesType, genre, publishedBy, synopsis
- StoryExpression: issueTitle, issueNumber, coverDate, storeDate, pageCount,
                   description, sku, upc, isbn, msrp, publishedBy, firstAppearance
- Character: characterName, realName, aliases, origin, powers, bio,
             firstAppearanceIn, belongsToFranchise
- Group: groupName, groupType, purpose
- Universe: universeName, designation, universeDescription
"""

import json
import sys
from urllib.parse import quote
from typing import TextIO, Iterator

# Ontology namespace
NAMESPACE = "http://knowledge.graph/ontology/narrative#"
BASE_URI = "http://knowledge.graph/data/"

# Prefix declarations for SPARQL output
PREFIXES = """PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX narrative: <http://knowledge.graph/ontology/narrative#>
PREFIX character: <http://knowledge.graph/ontology/character#>
PREFIX creator: <http://knowledge.graph/ontology/creator#>
PREFIX work: <http://knowledge.graph/ontology/work#>
PREFIX universe: <http://knowledge.graph/ontology/universe#>
PREFIX product: <http://knowledge.graph/ontology/product#>
PREFIX data: <http://knowledge.graph/data/>

"""


def safe_uri(s: str) -> str:
    """Convert string to safe URI component"""
    return quote(str(s).replace(" ", "_").replace("/", "_").replace(":", "_"), safe='')

def escape_sparql_string(s: str) -> str:
    """Escape string for SPARQL literal"""
    if s is None:
        return ""
    return str(s).replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\r', '\\r')

def generate_person_triples(creator_id: int, creator_name: str) -> list[str]:
    """Generate triples for a Person (creator)"""
    person_uri = f"<{BASE_URI}person/{creator_id}>"
    triples = [
        f'{person_uri} a <{NAMESPACE}Person> .',
        f'{person_uri} <http://www.w3.org/2000/01/rdf-schema#label> "{escape_sparql_string(creator_name)}" .',
        f'{person_uri} <{NAMESPACE}knownAs> "{escape_sparql_string(creator_name)}" .'
    ]
    return triples

def generate_org_triples(org_id: int, org_name: str, org_type: str = "Publisher") -> list[str]:
    """Generate triples for an Organization (publisher/imprint)"""
    org_uri = f"<{BASE_URI}org/{org_id}>"
    triples = [
        f'{org_uri} a <{NAMESPACE}Org> .',
        f'{org_uri} <http://www.w3.org/2000/01/rdf-schema#label> "{escape_sparql_string(org_name)}" .',
        f'{org_uri} <{NAMESPACE}legalName> "{escape_sparql_string(org_name)}" .',
        f'{org_uri} <{NAMESPACE}orgType> "{org_type}" .'
    ]
    return triples

def infer_tone(series_data: dict) -> str:
    """Infer tone from series data using heuristics"""
    name = series_data.get("name", "").lower()
    desc = series_data.get("desc", "").lower()
    genres = [g.get("name", "").lower() for g in series_data.get("genres", [])]
    
    # Check for dark/gritty tone
    if any(word in name + desc for word in ["dark", "noir", "grim", "gritty", "shadow"]):
        return "Dark"
    
    # Check for comedic tone
    if any(word in name + desc for word in ["funny", "comedy", "humor", "laugh", "silly"]):
        return "Comedic"
    
    # Check for wholesome tone
    if any(word in name + desc for word in ["adventure", "fun", "family", "friends"]):
        return "Wholesome"
    
    # Check for horror
    if "horror" in genres or any(word in name + desc for word in ["horror", "terror", "fear"]):
        return "Dark"
    
    # Default to Dramatic
    return "Dramatic"

def generate_series_triples(series_id: int, series_data: dict) -> list[str]:
    """Generate triples for a StoryWork (series) with narrative-rec.ttl extensions"""
    work_uri = f"<{BASE_URI}work/series_{series_id}>"
    triples = [
        f'{work_uri} a <{NAMESPACE}StoryWork> .',
        f'{work_uri} <http://www.w3.org/2000/01/rdf-schema#label> "{escape_sparql_string(series_data["name"])}" .',
        f'{work_uri} <{NAMESPACE}seriesName> "{escape_sparql_string(series_data["name"])}" .'
    ]
    
    # Add sortName if available
    if series_data.get("sort_name"):
        triples.append(f'{work_uri} <{NAMESPACE}sortName> "{escape_sparql_string(series_data["sort_name"])}" .')
    
    # Add volume
    if series_data.get("volume"):
        triples.append(f'{work_uri} <{NAMESPACE}volume> "{series_data["volume"]}"^^<http://www.w3.org/2001/XMLSchema#int> .')
    
    # Add year began
    if series_data.get("year_began"):
        triples.append(f'{work_uri} <{NAMESPACE}yearBegan> "{series_data["year_began"]}"^^<http://www.w3.org/2001/XMLSchema#int> .')
    
    # Add year ended if available
    if series_data.get("year_ended"):
        triples.append(f'{work_uri} <{NAMESPACE}yearEnded> "{series_data["year_ended"]}"^^<http://www.w3.org/2001/XMLSchema#int> .')
    
    # Add issue count if available
    if series_data.get("count_of_issues"):
        triples.append(f'{work_uri} <{NAMESPACE}issueCount> "{series_data["count_of_issues"]}"^^<http://www.w3.org/2001/XMLSchema#int> .')
    
    # Add series type
    if "series_type" in series_data and series_data["series_type"]:
        triples.append(f'{work_uri} <{NAMESPACE}seriesType> "{escape_sparql_string(series_data["series_type"]["name"])}" .')
    
    # Add genres as Genre instances with hasGenre relationships (narrative-rec.ttl)
    if "genres" in series_data:
        for genre in series_data["genres"]:
            genre_name = genre["name"]
            genre_uri = f'<{BASE_URI}genre/{safe_uri(genre_name)}>'
            # Create Genre instance
            triples.append(f'{genre_uri} a <{NAMESPACE}Genre> .')
            triples.append(f'{genre_uri} <http://www.w3.org/2000/01/rdf-schema#label> "{escape_sparql_string(genre_name)}" .')
            # Link work to genre
            triples.append(f'{work_uri} <{NAMESPACE}hasGenre> {genre_uri} .')
            # Legacy property for backward compatibility
            triples.append(f'{work_uri} <{NAMESPACE}genre> "{escape_sparql_string(genre_name)}" .')
    
    # Add publisher relationship
    if series_data.get("publisher"):
        pub_uri = f'<{BASE_URI}org/{series_data["publisher"]["id"]}>'
        triples.append(f'{work_uri} <{NAMESPACE}publishedBy> {pub_uri} .')
    
    # Add description/synopsis if available
    if series_data.get("desc"):
        desc = escape_sparql_string(series_data["desc"][:1000])  # Limit description length
        triples.append(f'{work_uri} <{NAMESPACE}synopsis> "{desc}" .')
    
    # Add ranking features from narrative-rec.ttl
    # Generate synthetic popularity score based on issue count and year
    issue_count = series_data.get("count_of_issues", 1)
    year_began = series_data.get("year_began", 2000)
    current_year = 2025
    years_active = max(1, current_year - year_began)
    
    # Popularity: more issues + longer run = higher score
    popularity = min(1.0, (issue_count / 500.0) * (years_active / 20.0))
    triples.append(f'{work_uri} <{NAMESPACE}popularityScore> "{popularity:.3f}"^^<http://www.w3.org/2001/XMLSchema#float> .')
    
    # Trending: recent series get higher scores
    recency_factor = max(0.0, 1.0 - (current_year - year_began) / 50.0)
    trending = min(1.0, recency_factor * (issue_count / 100.0))
    triples.append(f'{work_uri} <{NAMESPACE}trendingScore> \"{trending:.3f}\"^^<http://www.w3.org/2001/XMLSchema#float> .')
    
    # Completion rate: estimate based on series status
    completion_rate = 0.7  # Default
    if series_data.get("year_ended"):
        completion_rate = 0.85  # Completed series have higher completion
    triples.append(f'{work_uri} <{NAMESPACE}completionRate> \"{completion_rate:.2f}\"^^<http://www.w3.org/2001/XMLSchema#float> .')
    
    # Engagement score: combination of multiple factors
    engagement = min(1.0, (popularity + trending) / 2.0)
    triples.append(f'{work_uri} <{NAMESPACE}engagementScore> \"{engagement:.3f}\"^^<http://www.w3.org/2001/XMLSchema#float> .')
    
    # Add tone (narrative-rec.ttl)
    tone_value = infer_tone(series_data)
    tone_uri = f'<{BASE_URI}tone/{safe_uri(tone_value)}>'
    triples.append(f'{tone_uri} a <{NAMESPACE}Tone> .')
    triples.append(f'{tone_uri} <http://www.w3.org/2000/01/rdf-schema#label> \"{tone_value}\" .')
    triples.append(f'{work_uri} <{NAMESPACE}hasTone> {tone_uri} .')
    
    # Add themes based on genre (narrative-rec.ttl)
    genre_to_theme = {
        "superhero": "Heroism",
        "fantasy": "Magic",
        "sci-fi": "Technology",
        "horror": "Survival",
        "crime": "Justice",
        "romance": "Love"
    }
    
    for genre in series_data.get("genres", []):
        genre_lower = genre.get("name", "").lower()
        for genre_key, theme_name in genre_to_theme.items():
            if genre_key in genre_lower:
                theme_uri = f'<{BASE_URI}theme/{safe_uri(theme_name)}>'
                triples.append(f'{theme_uri} a <{NAMESPACE}Theme> .')
                triples.append(f'{theme_uri} <http://www.w3.org/2000/01/rdf-schema#label> \"{theme_name}\" .')
                triples.append(f'{work_uri} <{NAMESPACE}hasTheme> {theme_uri} .')
    
    return triples

def infer_format_class(issue_data: dict) -> str:
    """Infer format class from issue data"""
    series_type = issue_data.get("series", {}).get("series_type", {}).get("name", "").lower()
    page_count = issue_data.get("page_count") or 0
    
    if "trade paperback" in series_type or "tpb" in series_type:
        return "TradePaperback"
    elif "hardcover" in series_type or "hc" in series_type:
        return "Hardcover"
    elif "digital" in series_type:
        return "DigitalChapter"
    elif "graphic novel" in series_type:
        return "GraphicNovel"
    elif page_count and page_count > 100:
        return "CollectedEdition"
    else:
        return "SingleIssue"

def generate_issue_triples(issue_data: dict) -> list[str]:
    """Generate triples for a StoryExpression (issue) with narrative-rec.ttl extensions"""
    issue_id = issue_data["id"]
    expr_uri = f"<{BASE_URI}expression/issue_{issue_id}>"
    
    triples = [
        f'{expr_uri} a <{NAMESPACE}StoryExpression> .'
    ]
    
    # Add issue name/title
    if issue_data.get("issue_name"):
        triples.append(f'{expr_uri} <http://www.w3.org/2000/01/rdf-schema#label> "{escape_sparql_string(issue_data["issue_name"])}" .')
        triples.append(f'{expr_uri} <{NAMESPACE}issueTitle> "{escape_sparql_string(issue_data["issue_name"])}" .')
    
    # Add issue number
    if issue_data.get("number"):
        triples.append(f'{expr_uri} <{NAMESPACE}issueNumber> "{escape_sparql_string(issue_data["number"])}" .')
    
    # Add cover date
    if issue_data.get("cover_date"):
        triples.append(f'{expr_uri} <{NAMESPACE}coverDate> "{issue_data["cover_date"]}"^^<http://www.w3.org/2001/XMLSchema#date> .')
    
    # Add store date
    if issue_data.get("store_date"):
        triples.append(f'{expr_uri} <{NAMESPACE}storeDate> "{issue_data["store_date"]}"^^<http://www.w3.org/2001/XMLSchema#date> .')
    
    # Add MSRP (price)
    if issue_data.get("price"):
        triples.append(f'{expr_uri} <{NAMESPACE}msrp> "{issue_data["price"]}"^^<http://www.w3.org/2001/XMLSchema#decimal> .')
    
    # Add page count
    if issue_data.get("page_count"):
        triples.append(f'{expr_uri} <{NAMESPACE}pageCount> "{issue_data["page_count"]}"^^<http://www.w3.org/2001/XMLSchema#int> .')
    
    # Add description
    if issue_data.get("desc"):
        desc = escape_sparql_string(issue_data["desc"][:1000])  # Limit description length
        triples.append(f'{expr_uri} <{NAMESPACE}description> "{desc}" .')
    
    # Add SKU
    if issue_data.get("sku"):
        triples.append(f'{expr_uri} <{NAMESPACE}sku> "{escape_sparql_string(issue_data["sku"])}" .')
    
    # Add UPC
    if issue_data.get("upc"):
        triples.append(f'{expr_uri} <{NAMESPACE}upc> "{escape_sparql_string(issue_data["upc"])}" .')

    # Add image/cover
    if issue_data.get("image"):
        triples.append(f'{expr_uri} <{NAMESPACE}coverImage> "{escape_sparql_string(issue_data["image"])}"^^<http://www.w3.org/2001/XMLSchema#anyURI> .')
    
    # Add ISBN if available
    if issue_data.get("isbn"):
        triples.append(f'{expr_uri} <{NAMESPACE}isbn> "{escape_sparql_string(issue_data["isbn"])}" .')
    
    # Link to series (StoryWork)
    if "series" in issue_data and issue_data["series"]:
        work_uri = f'<{BASE_URI}work/series_{issue_data["series"]["id"]}>'
        triples.append(f'{expr_uri} <{NAMESPACE}expressionOf> {work_uri} .')
        triples.append(f'{work_uri} <{NAMESPACE}hasExpression> {expr_uri} .')
    
    # Link to publisher
    if "publisher" in issue_data and issue_data["publisher"]:
        pub_uri = f'<{BASE_URI}org/{issue_data["publisher"]["id"]}>'
        triples.append(f'{expr_uri} <{NAMESPACE}publishedBy> {pub_uri} .')
    
    # Create Manifestation and link format class (narrative-rec.ttl)
    # Each issue is also a Manifestation (physical/digital product)
    manif_uri = f"<{BASE_URI}manifestation/issue_{issue_id}>"
    triples.append(f'{manif_uri} a <{NAMESPACE}Manifestation> .')
    triples.append(f'{expr_uri} <{NAMESPACE}hasManifestation> {manif_uri} .')
    triples.append(f'{manif_uri} <{NAMESPACE}manifestationOf> {expr_uri} .')
    
    # Add format class
    format_class = infer_format_class(issue_data)
    format_uri = f'<{BASE_URI}format/{safe_uri(format_class)}>'
    triples.append(f'{format_uri} a <{NAMESPACE}FormatClass> .')
    triples.append(f'{format_uri} <http://www.w3.org/2000/01/rdf-schema#label> \"{format_class}\" .')
    triples.append(f'{manif_uri} <{NAMESPACE}hasFormatClass> {format_uri} .')
    
    return triples

def generate_credit_triples(issue_id: int, credit: dict, credit_index: int) -> list[str]:
    """Generate triples for a CreditRelationship"""
    credit_uri = f"<{BASE_URI}credit/{issue_id}_{credit['id']}_{credit_index}>"
    person_uri = f"<{BASE_URI}person/{credit['id']}>"
    expr_uri = f"<{BASE_URI}expression/issue_{issue_id}>"
    
    triples = [
        f'{credit_uri} a <{NAMESPACE}CreditRelationship> .',
        f'{person_uri} <{NAMESPACE}hasCreditRelationship> {credit_uri} .',
        f'{credit_uri} <{NAMESPACE}creditsExpression> {expr_uri} .',
        f'{credit_uri} <{NAMESPACE}creditedName> "{escape_sparql_string(credit["creator"])}" .',
        f'{credit_uri} <{NAMESPACE}billingOrder> "{credit_index}"^^<http://www.w3.org/2001/XMLSchema#int> .'
    ]
    
    # Add roles
    for role_data in credit.get("role", []):
        role_name = role_data["name"]
        # Map to ontology Role subclasses where possible
        role_uri = f'<{NAMESPACE}{safe_uri(role_name)}>'
        triples.append(f'{credit_uri} <{NAMESPACE}creditRole> {role_uri} .')
        triples.append(f'{credit_uri} <{BASE_URI}roleName> "{escape_sparql_string(role_name)}" .')
    
    return triples

def generate_character_triples(char_data: dict, series_id: int, issue_id: int = None) -> list[str]:
    """Generate triples for a Character"""
    char_id = char_data.get("id", "")
    if not char_id:
        # Generate ID from name if missing
        char_id = safe_uri(char_data["name"])
    
    char_uri = f"<{BASE_URI}character/{char_id}>"
    triples = [
        f'{char_uri} a <{NAMESPACE}Character> .',
        f'{char_uri} <http://www.w3.org/2000/01/rdf-schema#label> "{escape_sparql_string(char_data["name"])}" .',
        f'{char_uri} <{NAMESPACE}characterName> "{escape_sparql_string(char_data["name"])}" .'
    ]
    
    # Add real name if available
    if char_data.get("real_name"):
        triples.append(f'{char_uri} <{NAMESPACE}realName> "{escape_sparql_string(char_data["real_name"])}" .')
    
    # Add aliases if available
    if char_data.get("aliases"):
        # Can be string or list
        aliases = char_data["aliases"]
        if isinstance(aliases, str):
            triples.append(f'{char_uri} <{NAMESPACE}aliases> "{escape_sparql_string(aliases)}" .')
        elif isinstance(aliases, list):
            for alias in aliases:
                triples.append(f'{char_uri} <{NAMESPACE}aliases> "{escape_sparql_string(alias)}" .')
    
    # Add origin if available
    if char_data.get("origin"):
        origin = escape_sparql_string(char_data["origin"][:500])
        triples.append(f'{char_uri} <{NAMESPACE}origin> "{origin}" .')
    
    # Add powers if available
    if char_data.get("powers"):
        powers = escape_sparql_string(char_data["powers"][:1000])
        triples.append(f'{char_uri} <{NAMESPACE}powers> "{powers}" .')
    
    # Add description/bio if available
    if char_data.get("desc"):
        bio = escape_sparql_string(char_data["desc"][:1000])
        triples.append(f'{char_uri} <{NAMESPACE}bio> "{bio}" .')
    
    # Mark first appearance if this is their debut issue
    if issue_id and char_data.get("first_appeared_in_issue"):
        if str(char_data["first_appeared_in_issue"].get("id")) == str(issue_id):
            expr_uri = f'<{BASE_URI}expression/issue_{issue_id}>'
            triples.append(f'{char_uri} <{NAMESPACE}firstAppearanceIn> {expr_uri} .')
            triples.append(f'{expr_uri} <{NAMESPACE}firstAppearance> {char_uri} .')
    
    # Link to series/work as franchise
    if series_id:
        work_uri = f'<{BASE_URI}work/series_{series_id}>'
        triples.append(f'{char_uri} <{NAMESPACE}belongsToFranchise> {work_uri} .')
    
    # Generate tags for character themes (narrative-rec.ttl)
    # Extract themes from character name patterns
    char_name_lower = char_data["name"].lower()
    themes = []
    
    if any(word in char_name_lower for word in ["spider", "web", "arachnid"]):
        themes.append("Spider-Powers")
    if any(word in char_name_lower for word in ["dark", "shadow", "night"]):
        themes.append("Dark-Vigilante")
    if any(word in char_name_lower for word in ["super", "man", "woman", "girl", "boy"]):
        themes.append("Superhero")
    
    for theme_name in themes:
        tag_uri = f'<{BASE_URI}tag/{safe_uri(theme_name)}>'
        triples.append(f'{tag_uri} a <{NAMESPACE}Tag> .')
        triples.append(f'{tag_uri} <http://www.w3.org/2000/01/rdf-schema#label> "{theme_name}" .')
    
    return triples

def generate_group_triples(team_data: dict) -> list[str]:
    """Generate triples for a Group (team)"""
    team_id = team_data.get("id", safe_uri(team_data["name"]))
    team_uri = f"<{BASE_URI}group/{team_id}>"
    
    triples = [
        f'{team_uri} a <{NAMESPACE}Group> .',
        f'{team_uri} <http://www.w3.org/2000/01/rdf-schema#label> "{escape_sparql_string(team_data["name"])}" .',
        f'{team_uri} <{NAMESPACE}groupName> "{escape_sparql_string(team_data["name"])}" .'
    ]
    
    # Add group type (default to team)
    triples.append(f'{team_uri} <{NAMESPACE}groupType> "Hero Team" .')
    
    # Add description if available
    if team_data.get("desc"):
        desc = escape_sparql_string(team_data["desc"][:1000])
        triples.append(f'{team_uri} <{NAMESPACE}purpose> "{desc}" .')
    
    return triples

def generate_universe_triples(universe_data: dict) -> list[str]:
    """Generate triples for a Universe"""
    univ_id = universe_data.get("id", safe_uri(universe_data.get("name", "")))
    if not univ_id or not universe_data.get("name"):
        return []
    
    univ_uri = f"<{BASE_URI}universe/{univ_id}>"
    triples = [
        f'{univ_uri} a <{NAMESPACE}Universe> .',
        f'{univ_uri} <http://www.w3.org/2000/01/rdf-schema#label> "{escape_sparql_string(universe_data["name"])}" .',
        f'{univ_uri} <{NAMESPACE}universeName> "{escape_sparql_string(universe_data["name"])}" .'
    ]
    
    # Add designation if it looks like one (Earth-616, etc.)
    name = universe_data["name"]
    if "earth" in name.lower() or "universe" in name.lower():
        triples.append(f'{univ_uri} <{NAMESPACE}designation> "{escape_sparql_string(name)}" .')
    
    # Add description if available
    if universe_data.get("desc"):
        desc = escape_sparql_string(universe_data["desc"][:1000])
        triples.append(f'{univ_uri} <{NAMESPACE}universeDescription> "{desc}" .')
    
    return triples

def process_issue(issue: dict) -> Iterator[str]:
    """Process a single issue and yield SPARQL INSERT statements"""
    issue_id = issue["id"]
    
    # Generate all triples for this issue
    all_triples = []
    
    # 1. Publisher/Imprint orgs
    if "publisher" in issue and issue["publisher"]:
        pub = issue["publisher"]
        all_triples.extend(generate_org_triples(pub["id"], pub["name"], "Publisher"))
    
    if "imprint" in issue and issue["imprint"]:
        imp = issue["imprint"]
        all_triples.extend(generate_org_triples(imp["id"], imp["name"], "Imprint"))
    
    # 2. Series (StoryWork)
    if "series" in issue and issue["series"]:
        all_triples.extend(generate_series_triples(issue["series"]["id"], issue["series"]))
    
    # 3. Issue (StoryExpression)
    all_triples.extend(generate_issue_triples(issue))
    
    # 4. Credits (CreditRelationship + Person)
    for idx, credit in enumerate(issue.get("credits", [])):
        all_triples.extend(generate_person_triples(credit["id"], credit["creator"]))
        all_triples.extend(generate_credit_triples(issue_id, credit, idx))
    
    # 5. Characters
    for char in issue.get("characters", []):
        series_id = issue["series"]["id"] if "series" in issue and issue["series"] else None
        all_triples.extend(generate_character_triples(char, series_id, issue_id))
    
    # 6. Teams (treat as Groups)
    for team in issue.get("teams", []):
        all_triples.extend(generate_group_triples(team))
    
    # 7. Universes
    for universe in issue.get("universes", []):
        all_triples.extend(generate_universe_triples(universe))
    
    # Yield as INSERT DATA block
    if all_triples:
        yield "INSERT DATA {\n"
        for triple in all_triples:
            yield f"  {triple}\n"
        yield "} ;\n\n"

def stream_json_array(file_handle: TextIO, limit: int = None) -> Iterator[dict]:
    """Stream JSON array items without loading entire file into memory"""
    count = 0
    # Skip opening bracket
    line = file_handle.readline()
    if not line.strip().startswith('['):
        raise ValueError("Expected JSON array")
    
    buffer = ""
    brace_depth = 0
    in_string = False
    escape_next = False
    
    for line in file_handle:
        for char in line:
            if escape_next:
                buffer += char
                escape_next = False
                continue
            
            if char == '\\' and in_string:
                escape_next = True
                buffer += char
                continue
            
            if char == '"' and not escape_next:
                in_string = not in_string
            
            if not in_string:
                if char == '{':
                    brace_depth += 1
                elif char == '}':
                    brace_depth -= 1
            
            buffer += char
            
            # Complete object
            if brace_depth == 0 and buffer.strip() and not in_string:
                obj_str = buffer.strip().rstrip(',')
                if obj_str and obj_str != ']':
                    try:
                        obj = json.loads(obj_str)
                        yield obj
                        count += 1
                        if limit and count >= limit:
                            return
                    except json.JSONDecodeError as e:
                        print(f"Warning: Failed to parse object: {e}", file=sys.stderr)
                buffer = ""

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Convert comic JSON to SPARQL INSERT statements")
    parser.add_argument("input_file", help="Path to comic_output.json")
    parser.add_argument("-o", "--output", help="Output SPARQL file (default: stdout)")
    parser.add_argument("-l", "--limit", type=int, help="Limit number of issues to process")
    parser.add_argument("-s", "--skip", type=int, default=0, help="Skip first N issues")
    
    args = parser.parse_args()
    
    output_file = open(args.output, 'w') if args.output else sys.stdout
    
    try:
        with open(args.input_file, 'r', encoding='utf-8') as f:
            # Write SPARQL header
            output_file.write(f"# SPARQL INSERT statements generated from {args.input_file}\n")
            output_file.write(f"# Namespace: {NAMESPACE}\n")
            output_file.write(f"# Base URI: {BASE_URI}\n\n")
            
            issue_count = 0
            skipped = 0
            sparql_buffer = []
            
            for issue in stream_json_array(f, args.limit):
                if skipped < args.skip:
                    skipped += 1
                    continue
                
                issue_count += 1
                
                # Process and collect SPARQL for this issue
                for sparql_line in process_issue(issue):
                    sparql_buffer.append(sparql_line)
                
                # Progress indicator
                if issue_count % 100 == 0:
                    print(f"Processed {issue_count} issues...", file=sys.stderr)
            
            # Write all SPARQL, removing the trailing semicolon from the last statement
            if sparql_buffer:
                sparql_text = ''.join(sparql_buffer).rstrip()
                if sparql_text.endswith(';'):
                    sparql_text = sparql_text[:-1]
                output_file.write(sparql_text + '\n')
            
            print(f"\nTotal issues processed: {issue_count}", file=sys.stderr)
    
    finally:
        if output_file != sys.stdout:
            output_file.close()

if __name__ == "__main__":
    main()