package config

import "os"

type Config struct {
    DatabaseURL string
    Kubeconfig  string
    DryRun      bool
}

func FromEnv() Config {
    return Config{
        DatabaseURL: os.Getenv("DATABASE_URL"),
        Kubeconfig:  os.Getenv("KUBECONFIG"),
        DryRun:      os.Getenv("RAIBITSERVER_DRY_RUN") != "0",
    }
}
