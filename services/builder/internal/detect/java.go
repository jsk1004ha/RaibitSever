package detect

func IsJavaProject(files map[string]bool) bool { return files["pom.xml"] || files["build.gradle"] || files["build.gradle.kts"] }
