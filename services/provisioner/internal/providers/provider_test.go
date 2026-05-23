package providers

import "testing"

func TestDefaultCatalogCoversPaaSDBaaSResourceEngines(t *testing.T) {
	catalog := DefaultCatalog()
	for _, key := range []string{"postgresql", "sqlite", "mysql", "mariadb", "mongodb", "redis", "valkey", "object-storage", "qdrant", "vector-db", "nats", "message-queue"} {
		if catalog[key] == "" {
			t.Fatalf("default provider catalog missing %s", key)
		}
	}
}

func TestDefaultCatalogUsesStableOperatorNames(t *testing.T) {
	catalog := DefaultCatalog()
	if catalog["postgresql"] != "CloudNativePG" {
		t.Fatalf("unexpected PostgreSQL operator: %q", catalog["postgresql"])
	}
	if catalog["object-storage"] != "MinIO/S3 adapter" {
		t.Fatalf("unexpected object storage provider: %q", catalog["object-storage"])
	}
}
