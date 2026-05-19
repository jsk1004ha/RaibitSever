package detect

func IsNodeProject(files map[string]bool) bool { return files["package.json"] }
