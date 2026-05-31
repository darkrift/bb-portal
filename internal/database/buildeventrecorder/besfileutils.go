package buildeventrecorder

import (
	"strconv"
	"strings"

	bes "github.com/bazelbuild/bazel/src/main/java/com/google/devtools/build/lib/buildeventstream/proto"
	"github.com/buildbarn/bb-portal/ent/gen/ent"
	remoteexecution "github.com/bazelbuild/remote-apis/build/bazel/remote/execution/v2"
)

func shouldPersistBesFile(file *bes.File) bool {
	if file == nil {
		return false
	}
	uri := file.GetUri()
	if uri == "" {
		// Some BES file messages can inline contents instead of referencing a URI.
		return file.GetContents() != nil && len(file.GetContents()) > 0
	}
	if strings.HasPrefix(uri, "file://") {
		return false
	}
	return true
}

func applyBesFileFields(create *ent.InvocationFilesCreate, file *bes.File) *ent.InvocationFilesCreate {
	if create == nil || file == nil {
		return create
	}

	create.SetName(file.GetName())
	if uri := file.GetUri(); uri != "" {
		create.SetURI(uri)
	}
	if contents := file.GetContents(); len(contents) > 0 {
		create.SetContent(string(contents))
	}
	if digest := getFileDigestFromBesFile(file); digest != nil {
		create.SetDigest(*digest)
	}
	if sizeBytes := getFileSizeBytesFromBesFile(file); sizeBytes != nil {
		create.SetSizeBytes(*sizeBytes)
	}
	if digestFunction := getFileDigestFunctionFromBesFile(file); digestFunction != nil {
		create.SetDigestFunction(*digestFunction)
	}
	return create
}

func getFileDigestFromBesFile(file *bes.File) *string {
	var digest string
	if file == nil {
		return nil
	}
	if file.GetDigest() != "" {
		digest = file.GetDigest()
		return &digest
	}
	if uri := file.GetUri(); uri != "" {
		stringArr := strings.Split(uri, "/")
		if len(stringArr) < 2 {
			return nil
		}
		digest = stringArr[len(stringArr)-2]
		return &digest
	}
	return nil
}

func getFileSizeBytesFromBesFile(file *bes.File) *int64 {
	var sizeBytes int64
	if file == nil {
		return nil
	}
	if file.GetLength() != 0 {
		sizeBytes = file.GetLength()
		return &sizeBytes
	}
	if uri := file.GetUri(); uri != "" {
		stringArr := strings.Split(uri, "/")
		sizeBytes, err := strconv.ParseInt(stringArr[len(stringArr)-1], 10, 64)
		if err != nil {
			return nil
		}
		return &sizeBytes
	}
	return nil
}

func getFileDigestFunctionFromBesFile(file *bes.File) *string {
	if file == nil {
		return nil
	}
	defaultDigestFunction := strings.ToLower(remoteexecution.DigestFunction_SHA256.String())
	if uri := file.GetUri(); uri != "" {
		stringArr := strings.Split(uri, "/")
		if len(stringArr) < 3 {
			return &defaultDigestFunction
		}
		digestFunction := stringArr[len(stringArr)-3]
		if _, ok := remoteexecution.DigestFunction_Value_value[strings.ToUpper(digestFunction)]; ok {
			return &digestFunction
		}
	}
	return &defaultDigestFunction
}
