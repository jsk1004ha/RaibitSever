package main

import (
    "context"
    "fmt"

    "github.com/raibitserver/provisioner/internal/providers"
)

func main() {
    catalog := providers.DefaultCatalog()
    fmt.Printf("raibitserver provisioner providers=%d action=reconcile-resources\n", len(catalog))
    _ = context.Background()
}
