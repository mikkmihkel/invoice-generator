import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// The default 1 s for findBy*/waitFor is too tight for the editor and PDF previews on a busy CI runner.
configure({ asyncUtilTimeout: 4000 })
