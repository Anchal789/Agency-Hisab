import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorState } from '@/components/common/ErrorState'
import { Button } from '@/components/ui/button'

type Props = { children: ReactNode }
type State = { hasError: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto flex min-h-screen max-w-lg items-center px-4">
          <ErrorState
            title="This screen hit an unexpected error"
            description="The rest of the application was stopped so it would not keep going with bad state."
            action={
              <Button
                onClick={() => {
                  this.setState({ hasError: false })
                  window.location.assign('/')
                }}
              >
                Try again
              </Button>
            }
          />
        </div>
      )
    }
    return this.props.children
  }
}
