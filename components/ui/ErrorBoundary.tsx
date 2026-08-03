import { Component, ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { captureError } from '@/lib/monitoring'
import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'

interface Props {
  children: ReactNode
  context?: string
}

interface State {
  hasError: boolean
}

/**
 * React error boundary for React Native screens.
 * Captures unhandled render errors via the monitoring layer (Sentry when enabled).
 * Shows a friendly inline error with a "Try again" button.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  override componentDidCatch(error: unknown, info: { componentStack: string }) {
    captureError(error, {
      extra: {
        context:        this.props.context,
        componentStack: info.componentStack,
      },
    })
  }

  override render() {
    if (!this.state.hasError) return this.props.children

    return (
      <View style={styles.container}>
        <Text style={styles.emoji}>⚠️</Text>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          An unexpected error occurred. Please try again or restart the app.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
          onPress={() => this.setState({ hasError: false })}
        >
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    )
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
    backgroundColor: '#F9FAFB',
  },
  emoji: { fontSize: 40 },
  title: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.inkBlack,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
  },
  button: {
    marginTop: 8,
    height: 44,
    paddingHorizontal: 24,
    borderRadius: 14,
    backgroundColor: colors.cloudGrey,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: colors.inkBlack,
  },
})
