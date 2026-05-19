package detect

func DockerfileFirst(files map[string]bool, configuredPath string) (string, bool) {
    if configuredPath != "" {
        return configuredPath, true
    }
    if files["Dockerfile"] || files["./Dockerfile"] {
        return "Dockerfile", true
    }
    return "", false
}
