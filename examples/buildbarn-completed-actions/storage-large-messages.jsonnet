local base = import 'storage.jsonnet';

base {
  maximumMessageSizeBytes: 64 * 1024 * 1024,
}
