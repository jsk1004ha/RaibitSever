package logs

type BuildLogSink interface { WriteLine(buildID string, line string) error }
