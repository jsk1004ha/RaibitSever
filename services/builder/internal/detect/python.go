package detect

func IsPythonProject(files map[string]bool) bool { return files["requirements.txt"] || files["pyproject.toml"] }
