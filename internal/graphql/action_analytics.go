package graphql

func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
