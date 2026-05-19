package store

type DesiredStateStore interface {
    ListPendingServices() ([]ServiceDesiredState, error)
    MarkServiceReady(serviceID string, status string) error
}

type ServiceDesiredState struct {
    ID        string
    ProjectID string
    Image     string
    Port      int
}
