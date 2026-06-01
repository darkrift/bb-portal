local base = import 'browser.jsonnet';

base {
  maximumMessageSizeBytes: 64 * 1024 * 1024,
}
