import React, { useEffect } from 'react'
import {Route, Routes} from 'react-router-dom'
import Home from './pages/Home'
import Auth from './pages/Auth'
import axios from 'axios'
import { useDispatch } from 'react-redux'
import { setUserData } from './redux/userSlice'
import InterviewPage from './pages/InterviewPage'
import InterviewHistory from './pages/InterviewHistory'
import Pricing from './pages/Pricing'
import InterviewReport from './pages/InterviewReport'

export const serverUrl = "http://localhost:8000"

function App() {
  
  const dispatch = useDispatch()

  useEffect(() => {
      const controller = new AbortController()
      
      const getUser = async () => {
        try {
          const result = await axios.get(serverUrl + "/api/user/current-user", {
            withCredentials: true,
            signal: controller.signal
          })
          dispatch(setUserData(result.data))

        } catch (error) {
          if (error.name !== 'CanceledError') {
            console.log(error)
            dispatch(setUserData(null))
          }
        }
      }
      
      getUser()
      
      return () => controller.abort()

  }, [dispatch])

  return (
    <Routes>
      <Route path='/' element={<Home/>}/>
      <Route path='/auth' element={<Auth/>} />
      <Route path='/interview' element={<InterviewPage/>} />
      <Route path='/history' element={<InterviewHistory/>} />
      <Route path='/pricing' element={<Pricing/>} />
      <Route path='/report/:id' element={<InterviewReport/>} />
    </Routes>
  )
}

export default App
