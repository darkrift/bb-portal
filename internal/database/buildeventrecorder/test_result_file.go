package buildeventrecorder

import "net/url"

func shouldPersistTestResultFileURI(uri string) bool {
	if uri == "" {
		return false
	}

	parsedURI, err := url.Parse(uri)
	if err != nil {
		return false
	}

	return parsedURI.Scheme != "file"
}
