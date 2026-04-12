import { StyleSheet } from 'react-native'

const Styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
    paddingLeft: 24,
    paddingRight: 24
  },
  content: {
    fontSize: 16,
    fontFamily: 'lato',
    fontWeight: 400
  },
  contentHeading: {
    fontSize: 16,
    fontFamily: 'lato',
    fontWeight: 700
  },
  tablepadding: {
    alignItems: 'flex-start',
    padding: 10
  },
  horizontalLine: {
    height: 1,
    backgroundColor: '#D9D9D9'
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#11567F',
    padding: 15,
    cursor: 'pointer',
    borderRadius: 50,
    marginLeft: 25,
    marginRight: 25
  },
  subButton: {
    alignItems: 'center',
    backgroundColor: '#11567F',
    padding: 5,
    cursor: 'pointer',
    borderRadius: 50,
    width: 200
  },
  subButtonText: {
    color: '#FFFFFF',
    fontWeight: 700,
    fontSize: 16,
    fontFamily: 'lato',
    textAlign: 'center'
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 20,
    fontFamily: 'texta-black'
  },
  headerTitleStyle: {
    fontSize: 36,
    fontFamily: 'texta-black',
    color: '#11567F',
    fontWeight: 900
  }
});

export default Styles;