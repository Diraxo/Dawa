// Metro resolves these at bundle time; TS needs to know the shape of the
// default export (an opaque asset id) since no such declaration ships from
// expo/react-native's own type packages.
declare module '*.png' {
  const value: number
  export default value
}
declare module '*.jpg' {
  const value: number
  export default value
}
declare module '*.jpeg' {
  const value: number
  export default value
}
declare module '*.webp' {
  const value: number
  export default value
}
declare module '*.gif' {
  const value: number
  export default value
}
