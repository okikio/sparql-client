-- Ephemeral test instance only: enable standards-defined update operations.
GRANT SPARQL_UPDATE TO "SPARQL";
DB.DBA.RDF_DEFAULT_USER_PERMS_SET ('nobody', 7);
