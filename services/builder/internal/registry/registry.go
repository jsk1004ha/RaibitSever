package registry

type ImageRef struct {
    Registry string
    Project  string
    Service  string
    Tag      string
}

func (r ImageRef) String() string { return r.Registry + "/" + r.Project + "/" + r.Service + ":" + r.Tag }
