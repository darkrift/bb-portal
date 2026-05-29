package buildeventrecorder

import "testing"

func TestShouldPersistTestResultFileURI(t *testing.T) {
	tests := map[string]struct {
		uri  string
		want bool
	}{
		"empty": {
			uri:  "",
			want: false,
		},
		"localFile": {
			uri:  "file:///tmp/test.log",
			want: false,
		},
		"localFileWithHost": {
			uri:  "file://localhost/tmp/test.log",
			want: false,
		},
		"byteStream": {
			uri:  "bytestream://localhost:8980/blobs/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/123",
			want: true,
		},
		"http": {
			uri:  "https://example.com/test.log",
			want: true,
		},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			if got := shouldPersistTestResultFileURI(test.uri); got != test.want {
				t.Fatalf("shouldPersistTestResultFileURI(%q) = %v, want %v", test.uri, got, test.want)
			}
		})
	}
}
