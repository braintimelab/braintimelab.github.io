import serial #Serial imported for Serial communication
import time #Required to use delay functions
import datetime #For date-time setting

from tkinter import * #import the library for GUI making
from tkinter import ttk

import threading #to run Arduino loop and tkinter loop alongside

#Initialize the windows size and name
window = Tk()
window.title('1-LED 10-Box #1')
window.geometry('900x480')


#define and create serial object function
def create_serial_obj(portPath, baud_rate, timeout):
    """
    Given the port path, baud rate, creates
    and returns a pyserial object.
    """
    return serial.Serial(portPath, baud_rate, timeout=timeout)


###Define functions

def destruct(): # Quit the program
    root.quit()

def get_data(): # Start recording
    i=0
    #init csv file and write the COM port name
    headers = port_entry.get()
    filename= filename_entry.get()
    with open(filename,'w', encoding='utf-8') as w:
                w.write(headers+"\n")
    w.close()
    global serial_obj
    while True:
                string2=serial_obj.readline().decode('utf-8')
                csv_row = string2
                if string2 != '':
                    with open(filename,'a') as w:
                        w.write(string2)
                    w.close()
                print (string2)
                if i==0:
                    print("Synching time...")
                    t= datetime.datetime.now()
                    serial_obj.write(str.encode(t.strftime("%Y-%m-%d %H:%M:%S")))
                if i==1:
                    serial_obj.write(str.encode(hourOn1_1+minOn1_1+hourOff1_1+minOff1_1+
                                                hourOn2_1+minOn2_1+hourOff2_1+minOff2_1+
                                                hourOn3_1+minOn3_1+hourOff3_1+minOff3_1+
                                                hourOn4_1+minOn4_1+hourOff4_1+minOff4_1+
                                                hourOn5_1+minOn5_1+hourOff5_1+minOff5_1))
                if i==2:    
                    serial_obj.write(str.encode(hourOn6_1+minOn6_1+hourOff6_1+minOff6_1+
                                                hourOn7_1+minOn7_1+hourOff7_1+minOff7_1+
                                                hourOn8_1+minOn8_1+hourOff8_1+minOff8_1+
                                                hourOn9_1+minOn9_1+hourOff9_1+minOff9_1+
                                                hourOn10_1+minOn10_1+hourOff10_1+minOff10_1+
                                                dark1_1+light1_1+
                                                dark2_1+light2_1+
                                                dark3_1+light3_1+
                                                dark4_1+light4_1+
                                                dark5_1+light5_1+
                                                dark6_1+light6_1+
                                                dark7_1+light7_1+
                                                dark8_1+light8_1+
                                                dark9_1+light9_1+
                                                dark10_1+light10_1))                              
                if i==3:
                    serial_obj.write(str.encode(hourOn1_2+minOn1_2+hourOff1_2+minOff1_2+
                                                hourOn2_2+minOn2_1+hourOff2_1+minOff2_1+
                                                hourOn3_2+minOn3_1+hourOff3_1+minOff3_1+
                                                hourOn4_2+minOn4_1+hourOff4_1+minOff4_1+
                                                hourOn5_2+minOn5_1+hourOff5_1+minOff5_1))

                if i==4:
                    serial_obj.write(str.encode(hourOn6_2+minOn6_1+hourOff6_1+minOff6_1+
                                                hourOn7_2+minOn7_1+hourOff7_1+minOff7_1+
                                                hourOn8_2+minOn8_1+hourOff8_1+minOff8_1+
                                                hourOn9_2+minOn9_1+hourOff9_1+minOff9_1+
                                                hourOn10_2+minOn10_1+hourOff10_1+minOff10_1+
                                                dark1_2+light1_2+
                                                dark2_2+light2_2+
                                                dark3_2+light3_2+
                                                dark4_2+light4_2+
                                                dark5_2+light5_2+
                                                dark6_2+light6_2+
                                                dark7_2+light7_2+
                                                dark8_2+light8_2+
                                                dark9_2+light9_2+
                                                dark10_2+light10_2))
                if i==5:
                    serial_obj.write(str.encode(date1_2+month1_2+year1_2+
                                                date2_2+month2_2+year2_2+
                                                date3_2+month3_2+year3_2+
                                                date4_2+month4_2+year4_2+
                                                date5_2+month5_2+year5_2+
                                                hourFrom1_2+minuteFrom1_2+
                                                hourFrom2_2+minuteFrom2_2+
                                                hourFrom3_2+minuteFrom3_2+
                                                hourFrom4_2+minuteFrom4_2+
                                                hourFrom5_2+minuteFrom5_2))  
                if i==6:
                    serial_obj.write(str.encode(date6_2+month6_2+year6_2+
                                                date7_2+month7_2+year7_2+
                                                date8_2+month8_2+year8_2+
                                                date9_2+month9_2+year9_2+
                                                date10_2+month10_2+year10_2+
                                                hourFrom6_2+minuteFrom6_2+
                                                hourFrom7_2+minuteFrom7_2+
                                                hourFrom8_2+minuteFrom8_2+
                                                hourFrom9_2+minuteFrom9_2+
                                                hourFrom10_2+minuteFrom10_2))   
                if i==7:
                    serial_obj.write(str.encode(hourOn1_3+minOn1_3+hourOff1_3+minOff1_3+
                                                hourOn2_3+minOn2_3+hourOff2_3+minOff2_3+
                                                hourOn3_3+minOn3_3+hourOff3_3+minOff3_3+
                                                hourOn4_3+minOn4_3+hourOff4_3+minOff4_3+
                                                hourOn5_3+minOn5_3+hourOff5_3+minOff5_3))
                if i==8:
                    serial_obj.write(str.encode(hourOn6_3+minOn6_3+hourOff6_3+minOff6_3+
                                                hourOn7_3+minOn7_3+hourOff7_3+minOff7_3+
                                                hourOn8_3+minOn8_3+hourOff8_3+minOff8_3+
                                                hourOn9_3+minOn9_3+hourOff9_3+minOff9_3+
                                                hourOn10_3+minOn10_3+hourOff10_3+minOff10_3+
                                                dark1_3+light1_3+
                                                dark2_3+light2_3+
                                                dark3_3+light3_3+
                                                dark4_3+light4_3+
                                                dark5_3+light5_3+
                                                dark6_3+light6_3+
                                                dark7_3+light7_3+
                                                dark8_3+light8_3+
                                                dark9_3+light9_3+
                                                dark10_3+light10_3))
                if i==9:
                    serial_obj.write(str.encode(date1_3+month1_3+year1_3+
                                                date2_3+month2_3+year2_3+
                                                date3_3+month3_3+year3_3+
                                                date4_3+month4_3+year4_3+
                                                date5_3+month5_3+year5_3+
                                                hourFrom1_3+minuteFrom1_3+
                                                hourFrom2_3+minuteFrom2_3+
                                                hourFrom3_3+minuteFrom3_3+
                                                hourFrom4_3+minuteFrom4_3+
                                                hourFrom5_3+minuteFrom5_3)) 
                if i==10:
                    serial_obj.write(str.encode(date6_3+month6_3+year6_3+
                                                date7_3+month7_3+year7_3+
                                                date8_3+month8_3+year8_3+
                                                date9_3+month9_3+year9_3+
                                                date10_3+month10_3+year10_3+
                                                hourFrom6_3+minuteFrom6_3+
                                                hourFrom7_3+minuteFrom7_3+
                                                hourFrom8_3+minuteFrom8_3+
                                                hourFrom9_3+minuteFrom9_3+
                                                hourFrom10_3+minuteFrom10_3)) 
                i=i+1

def connect(): # Start to connect and call get_data - Link to Start in Recording menu
    port = port_entry.get()
    baud = baud_entry.get()
    timeout = int(timeout_entry.get())
    global serial_obj
    global t1
    try:
        serial_obj = create_serial_obj(port, baud, timeout=timeout)
    except NameError:
        print("Enter Baud and Port")
        return
    t1=threading.Thread(target=get_data)
    t1.daemon=True
    t1.start()
    
def disconnect(): #disconnect the serial_obj (haven't make it work yet)
    try:
        t1.terminate
    except AttributeError:
        print("Close without Using it -.-")
        return
    

def getBox1Schedule(): 
    global hourOn1_1
    global minOn1_1
    global hourOff1_1
    global minOff1_1
    global dark1_1
    global light1_1
    hourOn1_1=spin1_A_1.get()
    minOn1_1=spin1_B_1.get()
    hourOff1_1=spin1_C_1.get()
    minOff1_1=spin1_D_1.get()                            

    if var1_1.get()==1:
        dark1_1="0"
        light1_1="0"
    if var1_1.get()==2:
        dark1_1="1"
        light1_1="0"
    if var1_1.get()==3:
        dark1_1="0"
        light1_1="1"
    global date1_2
    global month1_2
    global year1_2
    global hourFrom1_2
    global minuteFrom1_2
    global hourOn1_2
    global minOn1_2
    global hourOff1_2
    global minOff1_2
    global dark1_2
    global light1_2
    date1_2 = date1_2_entry.get()
    month1_2 = month1_2_entry.get()
    year1_2 = year1_2_entry.get()
    hourFrom1_2= spin1_E_2.get()
    minuteFrom1_2= spin1_F_2.get()
    hourOn1_2=spin1_A_2.get()
    minOn1_2=spin1_B_2.get()
    hourOff1_2=spin1_C_2.get()
    minOff1_2=spin1_D_2.get()                            

    if var1_2.get()==1:
        dark1_2="0"
        light1_2="0"
    if var1_2.get()==2:
        dark1_2="1"
        light1_2="0"
    if var1_2.get()==3:
        dark1_2="0"
        light1_2="1"
    global date1_3
    global month1_3
    global year1_3
    global hourFrom1_3
    global minuteFrom1_3
    global hourOn1_3
    global minOn1_3
    global hourOff1_3
    global minOff1_3
    global dark1_3
    global light1_3
    date1_3 = date1_3_entry.get()
    month1_3 = month1_3_entry.get()
    year1_3 = year1_3_entry.get()
    hourFrom1_3= spin1_E_3.get()
    minuteFrom1_3= spin1_F_3.get()
    hourOn1_3=spin1_A_3.get()
    minOn1_3=spin1_B_3.get()
    hourOff1_3=spin1_C_3.get()
    minOff1_3=spin1_D_3.get()                            

    if var1_3.get()==1:
        dark1_3="0"
        light1_3="0"
    if var1_3.get()==2:
        dark1_3="1"
        light1_3="0"
    if var1_3.get()==3:
        dark1_3="0"
        light1_3="1"

def getBox2Schedule(): 
    global hourOn2_1
    global minOn2_1
    global hourOff2_1
    global minOff2_1
    global dark2_1
    global light2_1
    hourOn2_1=spin2_A_1.get()
    minOn2_1=spin2_B_1.get()
    hourOff2_1=spin2_C_1.get()
    minOff2_1=spin2_D_1.get()                            

    if var2_1.get()==1:
        dark2_1="0"
        light2_1="0"
    if var2_1.get()==2:
        dark2_1="1"
        light2_1="0"
    if var2_1.get()==3:
        dark2_1="0"
        light2_1="1"
    global date2_2
    global month2_2
    global year2_2
    global hourFrom2_2
    global minuteFrom2_2
    global hourOn2_2
    global minOn2_2
    global hourOff2_2
    global minOff2_2
    global dark2_2
    global light2_2
    date2_2 = date2_2_entry.get()
    month2_2 = month2_2_entry.get()
    year2_2 = year2_2_entry.get()
    hourFrom2_2= spin2_E_2.get()
    minuteFrom2_2= spin2_F_2.get()
    hourOn2_2=spin2_A_2.get()
    minOn2_2=spin2_B_2.get()
    hourOff2_2=spin2_C_2.get()
    minOff2_2=spin2_D_2.get()                            

    if var2_2.get()==1:
        dark2_2="0"
        light2_2="0"
    if var2_2.get()==2:
        dark2_2="1"
        light2_2="0"
    if var2_2.get()==3:
        dark2_2="0"
        light2_2="1"
    global date2_3
    global month2_3
    global year2_3
    global hourFrom2_3
    global minuteFrom2_3
    global hourOn2_3
    global minOn2_3
    global hourOff2_3
    global minOff2_3
    global dark2_3
    global light2_3
    date2_3 = date2_3_entry.get()
    month2_3 = month2_3_entry.get()
    year2_3 = year2_3_entry.get()
    hourFrom2_3= spin2_E_3.get()
    minuteFrom2_3= spin2_F_3.get()
    hourOn2_3=spin2_A_3.get()
    minOn2_3=spin2_B_3.get()
    hourOff2_3=spin2_C_3.get()
    minOff2_3=spin2_D_3.get()                            

    if var2_3.get()==1:
        dark2_3="0"
        light2_3="0"
    if var2_3.get()==2:
        dark2_3="1"
        light2_3="0"
    if var2_3.get()==3:
        dark2_3="0"
        light2_3="1"

def getBox3Schedule(): 
    global hourOn3_1
    global minOn3_1
    global hourOff3_1
    global minOff3_1
    global dark3_1
    global light3_1
    hourOn3_1=spin3_A_1.get()
    minOn3_1=spin3_B_1.get()
    hourOff3_1=spin3_C_1.get()
    minOff3_1=spin3_D_1.get()                            

    if var3_1.get()==1:
        dark3_1="0"
        light3_1="0"
    if var3_1.get()==2:
        dark3_1="1"
        light3_1="0"
    if var3_1.get()==3:
        dark3_1="0"
        light3_1="1"
    global date3_2
    global month3_2
    global year3_2
    global hourFrom3_2
    global minuteFrom3_2
    global hourOn3_2
    global minOn3_2
    global hourOff3_2
    global minOff3_2
    global dark3_2
    global light3_2
    date3_2 = date3_2_entry.get()
    month3_2 = month3_2_entry.get()
    year3_2 = year3_2_entry.get()
    hourFrom3_2= spin3_E_2.get()
    minuteFrom3_2= spin3_F_2.get()
    hourOn3_2=spin3_A_2.get()
    minOn3_2=spin3_B_2.get()
    hourOff3_2=spin3_C_2.get()
    minOff3_2=spin3_D_2.get()                            

    if var3_2.get()==1:
        dark3_2="0"
        light3_2="0"
    if var3_2.get()==2:
        dark3_2="1"
        light3_2="0"
    if var3_2.get()==3:
        dark3_2="0"
        light3_2="1"
    global date3_3
    global month3_3
    global year3_3
    global hourFrom3_3
    global minuteFrom3_3
    global hourOn3_3
    global minOn3_3
    global hourOff3_3
    global minOff3_3
    global dark3_3
    global light3_3
    date3_3 = date3_3_entry.get()
    month3_3 = month3_3_entry.get()
    year3_3 = year3_3_entry.get()
    hourFrom3_3= spin3_E_3.get()
    minuteFrom3_3= spin3_F_3.get()
    hourOn3_3=spin3_A_3.get()
    minOn3_3=spin3_B_3.get()
    hourOff3_3=spin3_C_3.get()
    minOff3_3=spin3_D_3.get()                            

    if var3_3.get()==1:
        dark3_3="0"
        light3_3="0"
    if var3_3.get()==2:
        dark3_3="1"
        light3_3="0"
    if var3_3.get()==3:
        dark3_3="0"
        light3_3="1"

def getBox4Schedule(): 
    global hourOn4_1
    global minOn4_1
    global hourOff4_1
    global minOff4_1
    global dark4_1
    global light4_1
    hourOn4_1=spin4_A_1.get()
    minOn4_1=spin4_B_1.get()
    hourOff4_1=spin4_C_1.get()
    minOff4_1=spin4_D_1.get()                            

    if var4_1.get()==1:
        dark4_1="0"
        light4_1="0"
    if var4_1.get()==2:
        dark4_1="1"
        light4_1="0"
    if var4_1.get()==3:
        dark4_1="0"
        light4_1="1"
    global date4_2
    global month4_2
    global year4_2
    global hourFrom4_2
    global minuteFrom4_2
    global hourOn4_2
    global minOn4_2
    global hourOff4_2
    global minOff4_2
    global dark4_2
    global light4_2
    date4_2 = date4_2_entry.get()
    month4_2 = month4_2_entry.get()
    year4_2 = year4_2_entry.get()
    hourFrom4_2= spin4_E_2.get()
    minuteFrom4_2= spin4_F_2.get()
    hourOn4_2=spin4_A_2.get()
    minOn4_2=spin4_B_2.get()
    hourOff4_2=spin4_C_2.get()
    minOff4_2=spin4_D_2.get()                            

    if var4_2.get()==1:
        dark4_2="0"
        light4_2="0"
    if var4_2.get()==2:
        dark4_2="1"
        light4_2="0"
    if var4_2.get()==3:
        dark4_2="0"
        light4_2="1"
    global date4_3
    global month4_3
    global year4_3
    global hourFrom4_3
    global minuteFrom4_3
    global hourOn4_3
    global minOn4_3
    global hourOff4_3
    global minOff4_3
    global dark4_3
    global light4_3
    date4_3 = date4_3_entry.get()
    month4_3 = month4_3_entry.get()
    year4_3 = year4_3_entry.get()
    hourFrom4_3= spin4_E_3.get()
    minuteFrom4_3= spin4_F_3.get()
    hourOn4_3=spin4_A_3.get()
    minOn4_3=spin4_B_3.get()
    hourOff4_3=spin4_C_3.get()
    minOff4_3=spin4_D_3.get()                            

    if var4_3.get()==1:
        dark4_3="0"
        light4_3="0"
    if var4_3.get()==2:
        dark4_3="1"
        light4_3="0"
    if var4_3.get()==3:
        dark4_3="0"
        light4_3="1"

def getBox5Schedule(): 
    global hourOn5_1
    global minOn5_1
    global hourOff5_1
    global minOff5_1
    global dark5_1
    global light5_1
    hourOn5_1=spin5_A_1.get()
    minOn5_1=spin5_B_1.get()
    hourOff5_1=spin5_C_1.get()
    minOff5_1=spin5_D_1.get()                            

    if var5_1.get()==1:
        dark5_1="0"
        light5_1="0"
    if var5_1.get()==2:
        dark5_1="1"
        light5_1="0"
    if var5_1.get()==3:
        dark5_1="0"
        light5_1="1"
    global date5_2
    global month5_2
    global year5_2
    global hourFrom5_2
    global minuteFrom5_2
    global hourOn5_2
    global minOn5_2
    global hourOff5_2
    global minOff5_2
    global dark5_2
    global light5_2
    date5_2 = date5_2_entry.get()
    month5_2 = month5_2_entry.get()
    year5_2 = year5_2_entry.get()
    hourFrom5_2= spin5_E_2.get()
    minuteFrom5_2= spin5_F_2.get()
    hourOn5_2=spin5_A_2.get()
    minOn5_2=spin5_B_2.get()
    hourOff5_2=spin5_C_2.get()
    minOff5_2=spin5_D_2.get()                            

    if var5_2.get()==1:
        dark5_2="0"
        light5_2="0"
    if var5_2.get()==2:
        dark5_2="1"
        light5_2="0"
    if var5_2.get()==3:
        dark5_2="0"
        light5_2="1"
    global date5_3
    global month5_3
    global year5_3
    global hourFrom5_3
    global minuteFrom5_3
    global hourOn5_3
    global minOn5_3
    global hourOff5_3
    global minOff5_3
    global dark5_3
    global light5_3
    date5_3 = date5_3_entry.get()
    month5_3 = month5_3_entry.get()
    year5_3 = year5_3_entry.get()
    hourFrom5_3= spin5_E_3.get()
    minuteFrom5_3= spin5_F_3.get()
    hourOn5_3=spin5_A_3.get()
    minOn5_3=spin5_B_3.get()
    hourOff5_3=spin5_C_3.get()
    minOff5_3=spin5_D_3.get()                            

    if var5_3.get()==1:
        dark5_3="0"
        light5_3="0"
    if var5_3.get()==2:
        dark5_3="1"
        light5_3="0"
    if var5_3.get()==3:
        dark5_3="0"
        light5_3="1"

def getBox6Schedule(): 
    global hourOn6_1
    global minOn6_1
    global hourOff6_1
    global minOff6_1
    global dark6_1
    global light6_1
    hourOn6_1=spin6_A_1.get()
    minOn6_1=spin6_B_1.get()
    hourOff6_1=spin6_C_1.get()
    minOff6_1=spin6_D_1.get()                            

    if var6_1.get()==1:
        dark6_1="0"
        light6_1="0"
    if var6_1.get()==2:
        dark6_1="1"
        light6_1="0"
    if var6_1.get()==3:
        dark6_1="0"
        light6_1="1"
    global date6_2
    global month6_2
    global year6_2
    global hourFrom6_2
    global minuteFrom6_2
    global hourOn6_2
    global minOn6_2
    global hourOff6_2
    global minOff6_2
    global dark6_2
    global light6_2
    date6_2 = date6_2_entry.get()
    month6_2 = month6_2_entry.get()
    year6_2 = year6_2_entry.get()
    hourFrom6_2= spin6_E_2.get()
    minuteFrom6_2= spin6_F_2.get()
    hourOn6_2=spin6_A_2.get()
    minOn6_2=spin6_B_2.get()
    hourOff6_2=spin6_C_2.get()
    minOff6_2=spin6_D_2.get()                            

    if var6_2.get()==1:
        dark6_2="0"
        light6_2="0"
    if var6_2.get()==2:
        dark6_2="1"
        light6_2="0"
    if var6_2.get()==3:
        dark6_2="0"
        light6_2="1"
    global date6_3
    global month6_3
    global year6_3
    global hourFrom6_3
    global minuteFrom6_3
    global hourOn6_3
    global minOn6_3
    global hourOff6_3
    global minOff6_3
    global dark6_3
    global light6_3
    date6_3 = date6_3_entry.get()
    month6_3 = month6_3_entry.get()
    year6_3 = year6_3_entry.get()
    hourFrom6_3= spin6_E_3.get()
    minuteFrom6_3= spin6_F_3.get()
    hourOn6_3=spin6_A_3.get()
    minOn6_3=spin6_B_3.get()
    hourOff6_3=spin6_C_3.get()
    minOff6_3=spin6_D_3.get()                            

    if var6_3.get()==1:
        dark6_3="0"
        light6_3="0"
    if var6_3.get()==2:
        dark6_3="1"
        light6_3="0"
    if var6_3.get()==3:
        dark6_3="0"
        light6_3="1"

def getBox7Schedule(): 
    global hourOn7_1
    global minOn7_1
    global hourOff7_1
    global minOff7_1
    global dark7_1
    global light7_1
    hourOn7_1=spin7_A_1.get()
    minOn7_1=spin7_B_1.get()
    hourOff7_1=spin7_C_1.get()
    minOff7_1=spin7_D_1.get()                            

    if var7_1.get()==1:
        dark7_1="0"
        light7_1="0"
    if var7_1.get()==2:
        dark7_1="1"
        light7_1="0"
    if var7_1.get()==3:
        dark7_1="0"
        light7_1="1"
    global date7_2
    global month7_2
    global year7_2
    global hourFrom7_2
    global minuteFrom7_2
    global hourOn7_2
    global minOn7_2
    global hourOff7_2
    global minOff7_2
    global dark7_2
    global light7_2
    date7_2 = date7_2_entry.get()
    month7_2 = month7_2_entry.get()
    year7_2 = year7_2_entry.get()
    hourFrom7_2= spin7_E_2.get()
    minuteFrom7_2= spin7_F_2.get()
    hourOn7_2=spin7_A_2.get()
    minOn7_2=spin7_B_2.get()
    hourOff7_2=spin7_C_2.get()
    minOff7_2=spin7_D_2.get()                            

    if var7_2.get()==1:
        dark7_2="0"
        light7_2="0"
    if var7_2.get()==2:
        dark7_2="1"
        light7_2="0"
    if var7_2.get()==3:
        dark7_2="0"
        light7_2="1"
    global date7_3
    global month7_3
    global year7_3
    global hourFrom7_3
    global minuteFrom7_3
    global hourOn7_3
    global minOn7_3
    global hourOff7_3
    global minOff7_3
    global dark7_3
    global light7_3
    date7_3 = date7_3_entry.get()
    month7_3 = month7_3_entry.get()
    year7_3 = year7_3_entry.get()
    hourFrom7_3= spin7_E_3.get()
    minuteFrom7_3= spin7_F_3.get()
    hourOn7_3=spin7_A_3.get()
    minOn7_3=spin7_B_3.get()
    hourOff7_3=spin7_C_3.get()
    minOff7_3=spin7_D_3.get()                            

    if var7_3.get()==1:
        dark7_3="0"
        light7_3="0"
    if var7_3.get()==2:
        dark7_3="1"
        light7_3="0"
    if var7_3.get()==3:
        dark7_3="0"
        light7_3="1"

def getBox8Schedule(): 
    global hourOn8_1
    global minOn8_1
    global hourOff8_1
    global minOff8_1
    global dark8_1
    global light8_1
    hourOn8_1=spin8_A_1.get()
    minOn8_1=spin8_B_1.get()
    hourOff8_1=spin8_C_1.get()
    minOff8_1=spin8_D_1.get()                            

    if var8_1.get()==1:
        dark8_1="0"
        light8_1="0"
    if var8_1.get()==2:
        dark8_1="1"
        light8_1="0"
    if var8_1.get()==3:
        dark8_1="0"
        light8_1="1"
    global date8_2
    global month8_2
    global year8_2
    global hourFrom8_2
    global minuteFrom8_2
    global hourOn8_2
    global minOn8_2
    global hourOff8_2
    global minOff8_2
    global dark8_2
    global light8_2
    date8_2 = date8_2_entry.get()
    month8_2 = month8_2_entry.get()
    year8_2 = year8_2_entry.get()
    hourFrom8_2= spin8_E_2.get()
    minuteFrom8_2= spin8_F_2.get()
    hourOn8_2=spin8_A_2.get()
    minOn8_2=spin8_B_2.get()
    hourOff8_2=spin8_C_2.get()
    minOff8_2=spin8_D_2.get()                            

    if var8_2.get()==1:
        dark8_2="0"
        light8_2="0"
    if var8_2.get()==2:
        dark8_2="1"
        light8_2="0"
    if var8_2.get()==3:
        dark8_2="0"
        light8_2="1"
    global date8_3
    global month8_3
    global year8_3
    global hourFrom8_3
    global minuteFrom8_3
    global hourOn8_3
    global minOn8_3
    global hourOff8_3
    global minOff8_3
    global dark8_3
    global light8_3
    date8_3 = date8_3_entry.get()
    month8_3 = month8_3_entry.get()
    year8_3 = year8_3_entry.get()
    hourFrom8_3= spin8_E_3.get()
    minuteFrom8_3= spin8_F_3.get()
    hourOn8_3=spin8_A_3.get()
    minOn8_3=spin8_B_3.get()
    hourOff8_3=spin8_C_3.get()
    minOff8_3=spin8_D_3.get()                            

    if var8_3.get()==1:
        dark8_3="0"
        light8_3="0"
    if var8_3.get()==2:
        dark8_3="1"
        light8_3="0"
    if var8_3.get()==3:
        dark8_3="0"
        light8_3="1"

def getBox9Schedule(): 
    global hourOn9_1
    global minOn9_1
    global hourOff9_1
    global minOff9_1
    global dark9_1
    global light9_1
    hourOn9_1=spin9_A_1.get()
    minOn9_1=spin9_B_1.get()
    hourOff9_1=spin9_C_1.get()
    minOff9_1=spin9_D_1.get()                            

    if var9_1.get()==1:
        dark9_1="0"
        light9_1="0"
    if var9_1.get()==2:
        dark9_1="1"
        light9_1="0"
    if var9_1.get()==3:
        dark9_1="0"
        light9_1="1"
    global date9_2
    global month9_2
    global year9_2
    global hourFrom9_2
    global minuteFrom9_2
    global hourOn9_2
    global minOn9_2
    global hourOff9_2
    global minOff9_2
    global dark9_2
    global light9_2
    date9_2 = date9_2_entry.get()
    month9_2 = month9_2_entry.get()
    year9_2 = year9_2_entry.get()
    hourFrom9_2= spin9_E_2.get()
    minuteFrom9_2= spin9_F_2.get()
    hourOn9_2=spin9_A_2.get()
    minOn9_2=spin9_B_2.get()
    hourOff9_2=spin9_C_2.get()
    minOff9_2=spin9_D_2.get()                            

    if var9_2.get()==1:
        dark9_2="0"
        light9_2="0"
    if var9_2.get()==2:
        dark9_2="1"
        light9_2="0"
    if var9_2.get()==3:
        dark9_2="0"
        light9_2="1"
    global date9_3
    global month9_3
    global year9_3
    global hourFrom9_3
    global minuteFrom9_3
    global hourOn9_3
    global minOn9_3
    global hourOff9_3
    global minOff9_3
    global dark9_3
    global light9_3
    date9_3 = date9_3_entry.get()
    month9_3 = month9_3_entry.get()
    year9_3 = year9_3_entry.get()
    hourFrom9_3= spin9_E_3.get()
    minuteFrom9_3= spin9_F_3.get()
    hourOn9_3=spin9_A_3.get()
    minOn9_3=spin9_B_3.get()
    hourOff9_3=spin9_C_3.get()
    minOff9_3=spin9_D_3.get()                            

    if var9_3.get()==1:
        dark9_3="0"
        light9_3="0"
    if var9_3.get()==2:
        dark9_3="1"
        light9_3="0"
    if var9_3.get()==3:
        dark9_3="0"
        light9_3="1"

def getBox10Schedule(): 
    global hourOn10_1
    global minOn10_1
    global hourOff10_1
    global minOff10_1
    global dark10_1
    global light10_1
    hourOn10_1=spin10_A_1.get()
    minOn10_1=spin10_B_1.get()
    hourOff10_1=spin10_C_1.get()
    minOff10_1=spin10_D_1.get()                            

    if var10_1.get()==1:
        dark10_1="0"
        light10_1="0"
    if var10_1.get()==2:
        dark10_1="1"
        light10_1="0"
    if var10_1.get()==3:
        dark10_1="0"
        light10_1="1"
    global date10_2
    global month10_2
    global year10_2
    global hourFrom10_2
    global minuteFrom10_2
    global hourOn10_2
    global minOn10_2
    global hourOff10_2
    global minOff10_2
    global dark10_2
    global light10_2
    date10_2 = date10_2_entry.get()
    month10_2 = month10_2_entry.get()
    year10_2 = year10_2_entry.get()
    hourFrom10_2= spin10_E_2.get()
    minuteFrom10_2= spin10_F_2.get()
    hourOn10_2=spin10_A_2.get()
    minOn10_2=spin10_B_2.get()
    hourOff10_2=spin10_C_2.get()
    minOff10_2=spin10_D_2.get()                            

    if var10_2.get()==1:
        dark10_2="0"
        light10_2="0"
    if var10_2.get()==2:
        dark10_2="1"
        light10_2="0"
    if var10_2.get()==3:
        dark10_2="0"
        light10_2="1"
    global date10_3
    global month10_3
    global year10_3
    global hourFrom10_3
    global minuteFrom10_3
    global hourOn10_3
    global minOn10_3
    global hourOff10_3
    global minOff10_3
    global dark10_3
    global light10_3
    date10_3 = date10_3_entry.get()
    month10_3 = month10_3_entry.get()
    year10_3 = year10_3_entry.get()
    hourFrom10_3= spin10_E_3.get()
    minuteFrom10_3= spin10_F_3.get()
    hourOn10_3=spin10_A_3.get()
    minOn10_3=spin10_B_3.get()
    hourOff10_3=spin10_C_3.get()
    minOff10_3=spin10_D_3.get()                            

    if var10_3.get()==1:
        dark10_3="0"
        light10_3="0"
    if var10_3.get()==2:
        dark10_3="1"
        light10_3="0"
    if var10_3.get()==3:
        dark10_3="0"
        light10_3="1"


if __name__ == "__main__":

    #### All of the components and their positions in the GUI ####
    # You can change the design from here #       
    menu = Menu(window) #define menu

    # Defubd Var keep track of the schedule
                                    #1 for LD
                                    #2 for DD
                                    #3 for LL           
    var1_1 = IntVar(value=1) 
    var1_2 = IntVar(value=1)
    var1_3 = IntVar(value=1)

    var2_1 = IntVar(value=1) 
    var2_2 = IntVar(value=1)
    var2_3 = IntVar(value=1)
  
    var3_1 = IntVar(value=1) 
    var3_2 = IntVar(value=1)
    var3_3 = IntVar(value=1)
  
    var4_1 = IntVar(value=1) 
    var4_2 = IntVar(value=1)
    var4_3 = IntVar(value=1)

    var5_1 = IntVar(value=1) 
    var5_2 = IntVar(value=1)
    var5_3 = IntVar(value=1)
  
    var6_1 = IntVar(value=1) 
    var6_2 = IntVar(value=1)
    var6_3 = IntVar(value=1)

    var7_1 = IntVar(value=1) 
    var7_2 = IntVar(value=1)
    var7_3 = IntVar(value=1)
  
    var8_1 = IntVar(value=1) 
    var8_2 = IntVar(value=1)
    var8_3 = IntVar(value=1)
  
    var9_1 = IntVar(value=1) 
    var9_2 = IntVar(value=1)
    var9_3 = IntVar(value=1)

    var10_1 = IntVar(value=1) 
    var10_2 = IntVar(value=1)
    var10_3 = IntVar(value=1)
   
    #Create file menu
    filemenu = Menu(menu)
    filemenu.add_command(label='Save')
    filemenu.add_command(label='Save data as...')
    filemenu.add_separator()
    filemenu.add_command(label='Quit', command=destruct)
    menu.add_cascade(label='File', menu=filemenu)

    #create recording menu
    recordingmenu = Menu(menu)
    recordingmenu.add_command(label='Start', command=connect)


    recordingmenu.add_command(label='Pause')
    recordingmenu.add_command(label='Halt', command=disconnect)
    menu.add_cascade(label='Recording', menu=recordingmenu)

    #create set menu
    setmenu = Menu(menu)
    setmenu.add_command(label='Set schedule')
    menu.add_cascade(label='Setting', menu=setmenu)
    window.config(menu=menu)

    tab_control = ttk.Notebook(window)

    tab1 = ttk.Frame(tab_control)
    tab2 = ttk.Frame(tab_control)
    tab3 = ttk.Frame(tab_control)
    tab4 = ttk.Frame(tab_control)
    tab5 = ttk.Frame(tab_control)
    tab6 = ttk.Frame(tab_control)
    tab7 = ttk.Frame(tab_control)
    tab8 = ttk.Frame(tab_control)
    tab9 = ttk.Frame(tab_control)
    tab10 = ttk.Frame(tab_control)

    tab_control.add(tab1, text='Box1')
    tab_control.add(tab2, text='Box2')
    tab_control.add(tab3, text='Box3')
    tab_control.add(tab4, text='Box4')
    tab_control.add(tab5, text='Box5')
    tab_control.add(tab6, text='Box6')
    tab_control.add(tab7, text='Box7')
    tab_control.add(tab8, text='Box8')
    tab_control.add(tab9, text='Box9')
    tab_control.add(tab10, text='Box10')


    
    #Entry for Port, Baud, timeout, filename to save
    port   = Label(text = "Port").place(x = 20, y = 410)
    baud   = Label(text = "Baud").place(x = 20, y = 450)
    timeout = Label(text = "Timeout").place(x= 200, y=410)
    filename = Label(text= "filename").place(x=200, y=450)

    
    port_entry = Entry(width = 7)
    port_entry.place(x = 70, y = 410)
    port_entry.insert(0,"COM3")
    baud_entry = Entry(width = 7)
    baud_entry.place(x = 70, y = 450)
    baud_entry.insert(0,"9600")
    timeout_entry = Entry(width = 7)
    timeout_entry.place(x=270,y=410)
    timeout_entry.insert(0,"10")
    filename_entry = Entry(width = 10)
    filename_entry.place(x=270,y=450)
    filename_entry.insert(0,"data.txt")
    
    row_adj = 2; # useful when a new row is added above

    # Box1
    btn1 = Button(tab1, text="Set", command=getBox1Schedule)
    tab1_title = Label(tab1, text= 'LED schedule', anchor='center')
    tab1_title.grid(column=0, row= -1+row_adj, columnspan='20', sticky='we')
    capSep1 = ttk.Separator(tab1, orient=HORIZONTAL)
    capSep1.grid(column=0, row = -2+row_adj, columnspan='20', sticky='we')
        # phase 1
    phaseLabel1_1=Label(tab1, text='Phase 1')
    rad1_A_1 = Radiobutton(tab1, text='LD', variable=var1_1, value=1)
    lbl1_A_1 = Label(tab1, text= 'On:')
    spin1_A_1 = Spinbox(tab1, from_=00, to=24, width=2)
    spin1_B_1 = Spinbox(tab1, from_=00, to=59, width=2)
    spin1_A_1.delete(0,"end")
    spin1_A_1.insert(0,"07")
    spin1_B_1.delete(0,"end")
    spin1_B_1.insert(0,"00")
    label1_h1_1 = Label(tab1, text='h')
    label1_m1_1 = Label(tab1, text='m')
    lbl1_B_1 = Label(tab1, text= 'Off:')
    spin1_C_1 = Spinbox(tab1, from_=0, to=24, width=2)
    spin1_D_1 = Spinbox(tab1, from_=00, to=59, width=2)
    spin1_C_1.delete(0,"end")
    spin1_C_1.insert(0,"19")
    spin1_D_1.delete(0,"end")
    spin1_D_1.insert(0,"00")
    label1_h2_1 = Label(tab1, text='h')
    label1_m2_1 = Label(tab1, text='m')
    rad1_B_1 = Radiobutton(tab1, text='DD', variable=var1_1, value=2)
    rad1_C_1 = Radiobutton(tab1, text='LL', variable=var1_1, value=3)

    phaseLabel1_1.grid(column=0, row=1+row_adj, padx=15, pady=10)

    rad1_A_1.grid(column=12, row=1+row_adj, padx=15, pady=10)
    lbl1_A_1.grid(column=13, row=1+row_adj, pady=10)
    spin1_A_1.grid(column=14,row=1+row_adj, pady=10)
    label1_h1_1.grid(column=15,row=1+row_adj, pady=10, sticky='w')
    spin1_B_1.grid(column=16,row=1+row_adj, pady=10)
    label1_m1_1.grid(column=17,row=1+row_adj, pady=10, sticky='w')
    lbl1_B_1.grid(column=18, row=1+row_adj, pady=10)
    spin1_C_1.grid(column=19,row=1+row_adj, pady=10)
    label1_h2_1.grid(column=20,row=1+row_adj, pady=10, sticky='w')
    spin1_D_1.grid(column=21,row=1+row_adj, pady=10)
    label1_m2_1.grid(column=22,row=1+row_adj, pady=10, sticky='w')
    rad1_B_1.grid(column=23, row=1+row_adj, padx=15, pady=10)
    rad1_C_1.grid(column=24, row=1+row_adj, pady=10)

        # phase 2
    phaseLabel1_2=Label(tab1, text='Phase 2')
    fromLabel1_2=Label(tab1, text='From:')
    space1_2=Label(tab1, text=" ")
    spin1_E_2 = Spinbox(tab1, from_=00, to=24, width=2)
    spin1_F_2 = Spinbox(tab1, from_=00, to=59, width=2)
    spin1_E_2.delete(0,"end")
    spin1_E_2.insert(0,"07")
    spin1_F_2.delete(0,"end")
    spin1_F_2.insert(0,"00")
    label1_h0_2 = Label(tab1, text='h')
    label1_m0_2 = Label(tab1, text='m')
    date1_2_entry = Spinbox(tab1, from_=00, to=31, width=4) 
    month1_2_entry = Spinbox(tab1, from_=00, to=12, width=4)
    year1_2_entry = Spinbox(tab1, from_=2018, to=2030, width=6) 
    date1_2_entry.delete(0,"end")
    date1_2_entry.insert(0,"DD")
    month1_2_entry.delete(0,"end")
    month1_2_entry.insert(0,"MM")
    year1_2_entry.delete(0,"end")
    year1_2_entry.insert(0,"YYYY")
    label1_d_2=Label(tab1, text= '/')
    label1_m_2=Label(tab1, text= '/')
    rad1_A_2 = Radiobutton(tab1, text='LD', variable=var1_2, value=1)
    lbl1_A_2 = Label(tab1, text= 'On:')
    spin1_A_2 = Spinbox(tab1, from_=00, to=24, width=2)
    spin1_B_2 = Spinbox(tab1, from_=00, to=59, width=2)
    spin1_A_2.delete(0,"end")
    spin1_A_2.insert(0,"07")
    spin1_B_2.delete(0,"end")
    spin1_B_2.insert(0,"00")
    label1_h1_2 = Label(tab1, text='h')
    label1_m1_2 = Label(tab1, text='m')
    lbl1_B_2 = Label(tab1, text= 'Off:')
    spin1_C_2 = Spinbox(tab1, from_=0, to=24, width=2)
    spin1_D_2 = Spinbox(tab1, from_=00, to=59, width=2)
    spin1_C_2.delete(0,"end")
    spin1_C_2.insert(0,"19")
    spin1_D_2.delete(0,"end")
    spin1_D_2.insert(0,"00")
    label1_h2_2 = Label(tab1, text='h')
    label1_m2_2 = Label(tab1, text='m')
    rad1_B_2 = Radiobutton(tab1, text='DD', variable=var1_2, value=2)
    rad1_C_2 = Radiobutton(tab1, text='LL', variable=var1_2, value=3)

    phaseLabel1_2.grid(column=0, row=2+row_adj, padx=15, pady=10)
    fromLabel1_2.grid(column=1,row=2+row_adj)
    spin1_E_2.grid(column=2,row=2+row_adj)
    label1_h0_2.grid(column=3,row=2+row_adj)
    spin1_F_2.grid(column=4,row=2+row_adj)
    label1_m0_2.grid(column=5,row=2+row_adj)
    space1_2.grid(column=6,row=2+row_adj,padx=5)
    date1_2_entry.grid(column=7, row=2+row_adj)
    label1_d_2.grid(column=8,row=2+row_adj)
    month1_2_entry.grid(column=9, row=2+row_adj)
    label1_m_2.grid(column=10,row=2+row_adj)
    year1_2_entry.grid(column=11, row=2+row_adj)
    rad1_A_2.grid(column=12, row=2+row_adj, padx=15, pady=10)
    lbl1_A_2.grid(column=13, row=2+row_adj, pady=10)
    spin1_A_2.grid(column=14,row=2+row_adj, pady=10)
    label1_h1_2.grid(column=15,row=2+row_adj, pady=10)
    spin1_B_2.grid(column=16,row=2+row_adj, pady=10)
    label1_m1_2.grid(column=17,row=2+row_adj, pady=10)
    lbl1_B_2.grid(column=18, row=2+row_adj, pady=10)
    spin1_C_2.grid(column=19,row=2+row_adj, pady=10)
    label1_h2_2.grid(column=20,row=2+row_adj, pady=10)
    spin1_D_2.grid(column=21,row=2+row_adj, pady=10)
    label1_m2_2.grid(column=22,row=2+row_adj, pady=10)
    rad1_B_2.grid(column=23, row=2+row_adj, padx=15, pady=10)
    rad1_C_2.grid(column=24, row=2+row_adj, pady=10)
        # phase 3
    phaseLabel1_3=Label(tab1, text='Phase 3')
    fromLabel1_3=Label(tab1, text='From:')
    space1_3=Label(tab1, text=" ")
    spin1_E_3 = Spinbox(tab1, from_=00, to=24, width=2)
    spin1_F_3 = Spinbox(tab1, from_=00, to=59, width=2)
    spin1_E_3.delete(0,"end")
    spin1_E_3.insert(0,"07")
    spin1_F_3.delete(0,"end")
    spin1_F_3.insert(0,"00")
    label1_h0_3 = Label(tab1, text='h')
    label1_m0_3 = Label(tab1, text='m')
    date1_3_entry = Spinbox(tab1, from_=00, to=31, width=4) 
    month1_3_entry = Spinbox(tab1, from_=00, to=12, width=4)
    year1_3_entry = Spinbox(tab1, from_=2018, to=2030, width=6) 
    date1_3_entry.delete(0,"end")
    date1_3_entry.insert(0,"DD")
    month1_3_entry.delete(0,"end")
    month1_3_entry.insert(0,"MM")
    year1_3_entry.delete(0,"end")
    year1_3_entry.insert(0,"YYYY")
    label1_d_3=Label(tab1, text= '/')
    label1_m_3=Label(tab1, text= '/')
    rad1_A_3 = Radiobutton(tab1, text='LD', variable=var1_3, value=1)
    lbl1_A_3 = Label(tab1, text= 'On:')
    spin1_A_3 = Spinbox(tab1, from_=00, to=24, width=2)
    spin1_B_3 = Spinbox(tab1, from_=00, to=59, width=2)
    spin1_A_3.delete(0,"end")
    spin1_A_3.insert(0,"07")
    spin1_B_3.delete(0,"end")
    spin1_B_3.insert(0,"00")
    label1_h1_3 = Label(tab1, text='h')
    label1_m1_3 = Label(tab1, text='m')
    lbl1_B_3 = Label(tab1, text= 'Off:')
    spin1_C_3 = Spinbox(tab1, from_=0, to=24, width=2)
    spin1_D_3 = Spinbox(tab1, from_=00, to=59, width=2)
    spin1_C_3.delete(0,"end")
    spin1_C_3.insert(0,"19")
    spin1_D_3.delete(0,"end")
    spin1_D_3.insert(0,"00")
    label1_h2_3 = Label(tab1, text='h')
    label1_m2_3 = Label(tab1, text='m')
    rad1_B_3 = Radiobutton(tab1, text='DD', variable=var1_3, value=2)
    rad1_C_3 = Radiobutton(tab1, text='LL', variable=var1_3, value=3)

    phaseLabel1_3.grid(column=0, row=3+row_adj, padx=15, pady=10)
    fromLabel1_3.grid(column=1,row=3+row_adj)
    spin1_E_3.grid(column=2,row=3+row_adj)
    label1_h0_3.grid(column=3,row=3+row_adj)
    spin1_F_3.grid(column=4,row=3+row_adj)
    label1_m0_3.grid(column=5,row=3+row_adj)
    space1_3.grid(column=6,row=3+row_adj,padx=5)
    date1_3_entry.grid(column=7, row=3+row_adj)
    label1_d_3.grid(column=8,row=3+row_adj)
    month1_3_entry.grid(column=9, row=3+row_adj)
    label1_m_3.grid(column=10,row=3+row_adj)
    year1_3_entry.grid(column=11, row=3+row_adj)
    rad1_A_3.grid(column=12, row=3+row_adj, padx=15, pady=10)
    lbl1_A_3.grid(column=13, row=3+row_adj, pady=10)
    spin1_A_3.grid(column=14,row=3+row_adj, pady=10)
    label1_h1_3.grid(column=15,row=3+row_adj, pady=10)
    spin1_B_3.grid(column=16,row=3+row_adj, pady=10)
    label1_m1_3.grid(column=17,row=3+row_adj, pady=10)
    lbl1_B_3.grid(column=18, row=3+row_adj, pady=10)
    spin1_C_3.grid(column=19,row=3+row_adj, pady=10)
    label1_h2_3.grid(column=20,row=3+row_adj, pady=10)
    spin1_D_3.grid(column=21,row=3+row_adj, pady=10)
    label1_m2_3.grid(column=22,row=3+row_adj, pady=10)
    rad1_B_3.grid(column=23, row=3+row_adj, padx=15, pady=10)
    rad1_C_3.grid(column=24, row=3+row_adj, pady=10)

    btn1.grid(column=25, row=4+row_adj, padx=25, pady=10)



    # Box2
    btn2 = Button(tab2, text="Set", command=getBox2Schedule)
    tab2_title = Label(tab2, text= 'LED schedule', anchor='center')
    tab2_title.grid(column=0, row= -1+row_adj, columnspan='20', sticky='we')
    capSep2 = ttk.Separator(tab2, orient=HORIZONTAL)
    capSep2.grid(column=0, row = -2+row_adj, columnspan='20', sticky='we')
        # phase 1
    phaseLabel2_1=Label(tab2, text='Phase 1')
    rad2_A_1 = Radiobutton(tab2, text='LD', variable=var2_1, value=1)
    lbl2_A_1 = Label(tab2, text= 'On:')
    spin2_A_1 = Spinbox(tab2, from_=00, to=24, width=2)
    spin2_B_1 = Spinbox(tab2, from_=00, to=59, width=2)
    spin2_A_1.delete(0,"end")
    spin2_A_1.insert(0,"07")
    spin2_B_1.delete(0,"end")
    spin2_B_1.insert(0,"00")
    label2_h1_1 = Label(tab2, text='h')
    label2_m1_1 = Label(tab2, text='m')
    lbl2_B_1 = Label(tab2, text= 'Off:')
    spin2_C_1 = Spinbox(tab2, from_=0, to=24, width=2)
    spin2_D_1 = Spinbox(tab2, from_=00, to=59, width=2)
    spin2_C_1.delete(0,"end")
    spin2_C_1.insert(0,"19")
    spin2_D_1.delete(0,"end")
    spin2_D_1.insert(0,"00")
    label2_h2_1 = Label(tab2, text='h')
    label2_m2_1 = Label(tab2, text='m')
    rad2_B_1 = Radiobutton(tab2, text='DD', variable=var2_1, value=2)
    rad2_C_1 = Radiobutton(tab2, text='LL', variable=var2_1, value=3)

    phaseLabel2_1.grid(column=0, row=1+row_adj, padx=15, pady=10)

    rad2_A_1.grid(column=12, row=1+row_adj, padx=15, pady=10)
    lbl2_A_1.grid(column=13, row=1+row_adj, pady=10)
    spin2_A_1.grid(column=14,row=1+row_adj, pady=10)
    label2_h1_1.grid(column=15,row=1+row_adj, pady=10, sticky='w')
    spin2_B_1.grid(column=16,row=1+row_adj, pady=10)
    label2_m1_1.grid(column=17,row=1+row_adj, pady=10, sticky='w')
    lbl2_B_1.grid(column=18, row=1+row_adj, pady=10)
    spin2_C_1.grid(column=19,row=1+row_adj, pady=10)
    label2_h2_1.grid(column=20,row=1+row_adj, pady=10, sticky='w')
    spin2_D_1.grid(column=21,row=1+row_adj, pady=10)
    label2_m2_1.grid(column=22,row=1+row_adj, pady=10, sticky='w')
    rad2_B_1.grid(column=23, row=1+row_adj, padx=15, pady=10)
    rad2_C_1.grid(column=24, row=1+row_adj, pady=10)

        # phase 2
    phaseLabel2_2=Label(tab2, text='Phase 2')
    fromLabel2_2=Label(tab2, text='From:')
    space2_2=Label(tab2, text=" ")
    spin2_E_2 = Spinbox(tab2, from_=00, to=24, width=2)
    spin2_F_2 = Spinbox(tab2, from_=00, to=59, width=2)
    spin2_E_2.delete(0,"end")
    spin2_E_2.insert(0,"07")
    spin2_F_2.delete(0,"end")
    spin2_F_2.insert(0,"00")
    label2_h0_2 = Label(tab2, text='h')
    label2_m0_2 = Label(tab2, text='m')
    date2_2_entry = Spinbox(tab2, from_=00, to=31, width=4) 
    month2_2_entry = Spinbox(tab2, from_=00, to=12, width=4)
    year2_2_entry = Spinbox(tab2, from_=2018, to=2030, width=6) 
    date2_2_entry.delete(0,"end")
    date2_2_entry.insert(0,"DD")
    month2_2_entry.delete(0,"end")
    month2_2_entry.insert(0,"MM")
    year2_2_entry.delete(0,"end")
    year2_2_entry.insert(0,"YYYY")
    label2_d_2=Label(tab2, text= '/')
    label2_m_2=Label(tab2, text= '/')
    rad2_A_2 = Radiobutton(tab2, text='LD', variable=var2_2, value=1)
    lbl2_A_2 = Label(tab2, text= 'On:')
    spin2_A_2 = Spinbox(tab2, from_=00, to=24, width=2)
    spin2_B_2 = Spinbox(tab2, from_=00, to=59, width=2)
    spin2_A_2.delete(0,"end")
    spin2_A_2.insert(0,"07")
    spin2_B_2.delete(0,"end")
    spin2_B_2.insert(0,"00")
    label2_h1_2 = Label(tab2, text='h')
    label2_m1_2 = Label(tab2, text='m')
    lbl2_B_2 = Label(tab2, text= 'Off:')
    spin2_C_2 = Spinbox(tab2, from_=0, to=24, width=2)
    spin2_D_2 = Spinbox(tab2, from_=00, to=59, width=2)
    spin2_C_2.delete(0,"end")
    spin2_C_2.insert(0,"19")
    spin2_D_2.delete(0,"end")
    spin2_D_2.insert(0,"00")
    label2_h2_2 = Label(tab2, text='h')
    label2_m2_2 = Label(tab2, text='m')
    rad2_B_2 = Radiobutton(tab2, text='DD', variable=var2_2, value=2)
    rad2_C_2 = Radiobutton(tab2, text='LL', variable=var2_2, value=3)

    phaseLabel2_2.grid(column=0, row=2+row_adj, padx=15, pady=10)
    fromLabel2_2.grid(column=1,row=2+row_adj)
    spin2_E_2.grid(column=2,row=2+row_adj)
    label2_h0_2.grid(column=3,row=2+row_adj)
    spin2_F_2.grid(column=4,row=2+row_adj)
    label2_m0_2.grid(column=5,row=2+row_adj)
    space2_2.grid(column=6,row=2+row_adj,padx=5)
    date2_2_entry.grid(column=7, row=2+row_adj)
    label2_d_2.grid(column=8,row=2+row_adj)
    month2_2_entry.grid(column=9, row=2+row_adj)
    label2_m_2.grid(column=10,row=2+row_adj)
    year2_2_entry.grid(column=11, row=2+row_adj)
    rad2_A_2.grid(column=12, row=2+row_adj, padx=15, pady=10)
    lbl2_A_2.grid(column=13, row=2+row_adj, pady=10)
    spin2_A_2.grid(column=14,row=2+row_adj, pady=10)
    label2_h1_2.grid(column=15,row=2+row_adj, pady=10)
    spin2_B_2.grid(column=16,row=2+row_adj, pady=10)
    label2_m1_2.grid(column=17,row=2+row_adj, pady=10)
    lbl2_B_2.grid(column=18, row=2+row_adj, pady=10)
    spin2_C_2.grid(column=19,row=2+row_adj, pady=10)
    label2_h2_2.grid(column=20,row=2+row_adj, pady=10)
    spin2_D_2.grid(column=21,row=2+row_adj, pady=10)
    label2_m2_2.grid(column=22,row=2+row_adj, pady=10)
    rad2_B_2.grid(column=23, row=2+row_adj, padx=15, pady=10)
    rad2_C_2.grid(column=24, row=2+row_adj, pady=10)
        # phase 3
    phaseLabel2_3=Label(tab2, text='Phase 3')
    fromLabel2_3=Label(tab2, text='From:')
    space2_3=Label(tab2, text=" ")
    spin2_E_3 = Spinbox(tab2, from_=00, to=24, width=2)
    spin2_F_3 = Spinbox(tab2, from_=00, to=59, width=2)
    spin2_E_3.delete(0,"end")
    spin2_E_3.insert(0,"07")
    spin2_F_3.delete(0,"end")
    spin2_F_3.insert(0,"00")
    label2_h0_3 = Label(tab2, text='h')
    label2_m0_3 = Label(tab2, text='m')
    date2_3_entry = Spinbox(tab2, from_=00, to=31, width=4) 
    month2_3_entry = Spinbox(tab2, from_=00, to=12, width=4)
    year2_3_entry = Spinbox(tab2, from_=2018, to=2030, width=6) 
    date2_3_entry.delete(0,"end")
    date2_3_entry.insert(0,"DD")
    month2_3_entry.delete(0,"end")
    month2_3_entry.insert(0,"MM")
    year2_3_entry.delete(0,"end")
    year2_3_entry.insert(0,"YYYY")
    label2_d_3=Label(tab2, text= '/')
    label2_m_3=Label(tab2, text= '/')
    rad2_A_3 = Radiobutton(tab2, text='LD', variable=var2_3, value=1)
    lbl2_A_3 = Label(tab2, text= 'On:')
    spin2_A_3 = Spinbox(tab2, from_=00, to=24, width=2)
    spin2_B_3 = Spinbox(tab2, from_=00, to=59, width=2)
    spin2_A_3.delete(0,"end")
    spin2_A_3.insert(0,"07")
    spin2_B_3.delete(0,"end")
    spin2_B_3.insert(0,"00")
    label2_h1_3 = Label(tab2, text='h')
    label2_m1_3 = Label(tab2, text='m')
    lbl2_B_3 = Label(tab2, text= 'Off:')
    spin2_C_3 = Spinbox(tab2, from_=0, to=24, width=2)
    spin2_D_3 = Spinbox(tab2, from_=00, to=59, width=2)
    spin2_C_3.delete(0,"end")
    spin2_C_3.insert(0,"19")
    spin2_D_3.delete(0,"end")
    spin2_D_3.insert(0,"00")
    label2_h2_3 = Label(tab2, text='h')
    label2_m2_3 = Label(tab2, text='m')
    rad2_B_3 = Radiobutton(tab2, text='DD', variable=var2_3, value=2)
    rad2_C_3 = Radiobutton(tab2, text='LL', variable=var2_3, value=3)

    phaseLabel2_3.grid(column=0, row=3+row_adj, padx=15, pady=10)
    fromLabel2_3.grid(column=1,row=3+row_adj)
    spin2_E_3.grid(column=2,row=3+row_adj)
    label2_h0_3.grid(column=3,row=3+row_adj)
    spin2_F_3.grid(column=4,row=3+row_adj)
    label2_m0_3.grid(column=5,row=3+row_adj)
    space2_3.grid(column=6,row=3+row_adj,padx=5)
    date2_3_entry.grid(column=7, row=3+row_adj)
    label2_d_3.grid(column=8,row=3+row_adj)
    month2_3_entry.grid(column=9, row=3+row_adj)
    label2_m_3.grid(column=10,row=3+row_adj)
    year2_3_entry.grid(column=11, row=3+row_adj)
    rad2_A_3.grid(column=12, row=3+row_adj, padx=15, pady=10)
    lbl2_A_3.grid(column=13, row=3+row_adj, pady=10)
    spin2_A_3.grid(column=14,row=3+row_adj, pady=10)
    label2_h1_3.grid(column=15,row=3+row_adj, pady=10)
    spin2_B_3.grid(column=16,row=3+row_adj, pady=10)
    label2_m1_3.grid(column=17,row=3+row_adj, pady=10)
    lbl2_B_3.grid(column=18, row=3+row_adj, pady=10)
    spin2_C_3.grid(column=19,row=3+row_adj, pady=10)
    label2_h2_3.grid(column=20,row=3+row_adj, pady=10)
    spin2_D_3.grid(column=21,row=3+row_adj, pady=10)
    label2_m2_3.grid(column=22,row=3+row_adj, pady=10)
    rad2_B_3.grid(column=23, row=3+row_adj, padx=15, pady=10)
    rad2_C_3.grid(column=24, row=3+row_adj, pady=10)

    btn2.grid(column=25, row=4+row_adj, padx=25, pady=10)

    # Box3
    btn3 = Button(tab3, text="Set", command=getBox3Schedule)
    tab3_title = Label(tab3, text= 'LED schedule', anchor='center')
    tab3_title.grid(column=0, row= -1+row_adj, columnspan='20', sticky='we')
    capSep3 = ttk.Separator(tab3, orient=HORIZONTAL)
    capSep3.grid(column=0, row = -2+row_adj, columnspan='20', sticky='we')
        # phase 1
    phaseLabel3_1=Label(tab3, text='Phase 1')
    rad3_A_1 = Radiobutton(tab3, text='LD', variable=var3_1, value=1)
    lbl3_A_1 = Label(tab3, text= 'On:')
    spin3_A_1 = Spinbox(tab3, from_=00, to=24, width=2)
    spin3_B_1 = Spinbox(tab3, from_=00, to=59, width=2)
    spin3_A_1.delete(0,"end")
    spin3_A_1.insert(0,"07")
    spin3_B_1.delete(0,"end")
    spin3_B_1.insert(0,"00")
    label3_h1_1 = Label(tab3, text='h')
    label3_m1_1 = Label(tab3, text='m')
    lbl3_B_1 = Label(tab3, text= 'Off:')
    spin3_C_1 = Spinbox(tab3, from_=0, to=24, width=2)
    spin3_D_1 = Spinbox(tab3, from_=00, to=59, width=2)
    spin3_C_1.delete(0,"end")
    spin3_C_1.insert(0,"19")
    spin3_D_1.delete(0,"end")
    spin3_D_1.insert(0,"00")
    label3_h2_1 = Label(tab3, text='h')
    label3_m2_1 = Label(tab3, text='m')
    rad3_B_1 = Radiobutton(tab3, text='DD', variable=var3_1, value=2)
    rad3_C_1 = Radiobutton(tab3, text='LL', variable=var3_1, value=3)

    phaseLabel3_1.grid(column=0, row=1+row_adj, padx=15, pady=10)

    rad3_A_1.grid(column=12, row=1+row_adj, padx=15, pady=10)
    lbl3_A_1.grid(column=13, row=1+row_adj, pady=10)
    spin3_A_1.grid(column=14,row=1+row_adj, pady=10)
    label3_h1_1.grid(column=15,row=1+row_adj, pady=10, sticky='w')
    spin3_B_1.grid(column=16,row=1+row_adj, pady=10)
    label3_m1_1.grid(column=17,row=1+row_adj, pady=10, sticky='w')
    lbl3_B_1.grid(column=18, row=1+row_adj, pady=10)
    spin3_C_1.grid(column=19,row=1+row_adj, pady=10)
    label3_h2_1.grid(column=20,row=1+row_adj, pady=10, sticky='w')
    spin3_D_1.grid(column=21,row=1+row_adj, pady=10)
    label3_m2_1.grid(column=22,row=1+row_adj, pady=10, sticky='w')
    rad3_B_1.grid(column=23, row=1+row_adj, padx=15, pady=10)
    rad3_C_1.grid(column=24, row=1+row_adj, pady=10)

        # phase 2
    phaseLabel3_2=Label(tab3, text='Phase 2')
    fromLabel3_2=Label(tab3, text='From:')
    space3_2=Label(tab3, text=" ")
    spin3_E_2 = Spinbox(tab3, from_=00, to=24, width=2)
    spin3_F_2 = Spinbox(tab3, from_=00, to=59, width=2)
    spin3_E_2.delete(0,"end")
    spin3_E_2.insert(0,"07")
    spin3_F_2.delete(0,"end")
    spin3_F_2.insert(0,"00")
    label3_h0_2 = Label(tab3, text='h')
    label3_m0_2 = Label(tab3, text='m')
    date3_2_entry = Spinbox(tab3, from_=00, to=31, width=4) 
    month3_2_entry = Spinbox(tab3, from_=00, to=12, width=4)
    year3_2_entry = Spinbox(tab3, from_=2018, to=2030, width=6) 
    date3_2_entry.delete(0,"end")
    date3_2_entry.insert(0,"DD")
    month3_2_entry.delete(0,"end")
    month3_2_entry.insert(0,"MM")
    year3_2_entry.delete(0,"end")
    year3_2_entry.insert(0,"YYYY")
    label3_d_2=Label(tab3, text= '/')
    label3_m_2=Label(tab3, text= '/')
    rad3_A_2 = Radiobutton(tab3, text='LD', variable=var3_2, value=1)
    lbl3_A_2 = Label(tab3, text= 'On:')
    spin3_A_2 = Spinbox(tab3, from_=00, to=24, width=2)
    spin3_B_2 = Spinbox(tab3, from_=00, to=59, width=2)
    spin3_A_2.delete(0,"end")
    spin3_A_2.insert(0,"07")
    spin3_B_2.delete(0,"end")
    spin3_B_2.insert(0,"00")
    label3_h1_2 = Label(tab3, text='h')
    label3_m1_2 = Label(tab3, text='m')
    lbl3_B_2 = Label(tab3, text= 'Off:')
    spin3_C_2 = Spinbox(tab3, from_=0, to=24, width=2)
    spin3_D_2 = Spinbox(tab3, from_=00, to=59, width=2)
    spin3_C_2.delete(0,"end")
    spin3_C_2.insert(0,"19")
    spin3_D_2.delete(0,"end")
    spin3_D_2.insert(0,"00")
    label3_h2_2 = Label(tab3, text='h')
    label3_m2_2 = Label(tab3, text='m')
    rad3_B_2 = Radiobutton(tab3, text='DD', variable=var3_2, value=2)
    rad3_C_2 = Radiobutton(tab3, text='LL', variable=var3_2, value=3)

    phaseLabel3_2.grid(column=0, row=2+row_adj, padx=15, pady=10)
    fromLabel3_2.grid(column=1,row=2+row_adj)
    spin3_E_2.grid(column=2,row=2+row_adj)
    label3_h0_2.grid(column=3,row=2+row_adj)
    spin3_F_2.grid(column=4,row=2+row_adj)
    label3_m0_2.grid(column=5,row=2+row_adj)
    space3_2.grid(column=6,row=2+row_adj,padx=5)
    date3_2_entry.grid(column=7, row=2+row_adj)
    label3_d_2.grid(column=8,row=2+row_adj)
    month3_2_entry.grid(column=9, row=2+row_adj)
    label3_m_2.grid(column=10,row=2+row_adj)
    year3_2_entry.grid(column=11, row=2+row_adj)
    rad3_A_2.grid(column=12, row=2+row_adj, padx=15, pady=10)
    lbl3_A_2.grid(column=13, row=2+row_adj, pady=10)
    spin3_A_2.grid(column=14,row=2+row_adj, pady=10)
    label3_h1_2.grid(column=15,row=2+row_adj, pady=10)
    spin3_B_2.grid(column=16,row=2+row_adj, pady=10)
    label3_m1_2.grid(column=17,row=2+row_adj, pady=10)
    lbl3_B_2.grid(column=18, row=2+row_adj, pady=10)
    spin3_C_2.grid(column=19,row=2+row_adj, pady=10)
    label3_h2_2.grid(column=20,row=2+row_adj, pady=10)
    spin3_D_2.grid(column=21,row=2+row_adj, pady=10)
    label3_m2_2.grid(column=22,row=2+row_adj, pady=10)
    rad3_B_2.grid(column=23, row=2+row_adj, padx=15, pady=10)
    rad3_C_2.grid(column=24, row=2+row_adj, pady=10)
        # phase 3
    phaseLabel3_3=Label(tab3, text='Phase 3')
    fromLabel3_3=Label(tab3, text='From:')
    space3_3=Label(tab3, text=" ")
    spin3_E_3 = Spinbox(tab3, from_=00, to=24, width=2)
    spin3_F_3 = Spinbox(tab3, from_=00, to=59, width=2)
    spin3_E_3.delete(0,"end")
    spin3_E_3.insert(0,"07")
    spin3_F_3.delete(0,"end")
    spin3_F_3.insert(0,"00")
    label3_h0_3 = Label(tab3, text='h')
    label3_m0_3 = Label(tab3, text='m')
    date3_3_entry = Spinbox(tab3, from_=00, to=31, width=4) 
    month3_3_entry = Spinbox(tab3, from_=00, to=12, width=4)
    year3_3_entry = Spinbox(tab3, from_=2018, to=2030, width=6) 
    date3_3_entry.delete(0,"end")
    date3_3_entry.insert(0,"DD")
    month3_3_entry.delete(0,"end")
    month3_3_entry.insert(0,"MM")
    year3_3_entry.delete(0,"end")
    year3_3_entry.insert(0,"YYYY")
    label3_d_3=Label(tab3, text= '/')
    label3_m_3=Label(tab3, text= '/')
    rad3_A_3 = Radiobutton(tab3, text='LD', variable=var3_3, value=1)
    lbl3_A_3 = Label(tab3, text= 'On:')
    spin3_A_3 = Spinbox(tab3, from_=00, to=24, width=2)
    spin3_B_3 = Spinbox(tab3, from_=00, to=59, width=2)
    spin3_A_3.delete(0,"end")
    spin3_A_3.insert(0,"07")
    spin3_B_3.delete(0,"end")
    spin3_B_3.insert(0,"00")
    label3_h1_3 = Label(tab3, text='h')
    label3_m1_3 = Label(tab3, text='m')
    lbl3_B_3 = Label(tab3, text= 'Off:')
    spin3_C_3 = Spinbox(tab3, from_=0, to=24, width=2)
    spin3_D_3 = Spinbox(tab3, from_=00, to=59, width=2)
    spin3_C_3.delete(0,"end")
    spin3_C_3.insert(0,"19")
    spin3_D_3.delete(0,"end")
    spin3_D_3.insert(0,"00")
    label3_h2_3 = Label(tab3, text='h')
    label3_m2_3 = Label(tab3, text='m')
    rad3_B_3 = Radiobutton(tab3, text='DD', variable=var3_3, value=2)
    rad3_C_3 = Radiobutton(tab3, text='LL', variable=var3_3, value=3)

    phaseLabel3_3.grid(column=0, row=3+row_adj, padx=15, pady=10)
    fromLabel3_3.grid(column=1,row=3+row_adj)
    spin3_E_3.grid(column=2,row=3+row_adj)
    label3_h0_3.grid(column=3,row=3+row_adj)
    spin3_F_3.grid(column=4,row=3+row_adj)
    label3_m0_3.grid(column=5,row=3+row_adj)
    space3_3.grid(column=6,row=3+row_adj,padx=5)
    date3_3_entry.grid(column=7, row=3+row_adj)
    label3_d_3.grid(column=8,row=3+row_adj)
    month3_3_entry.grid(column=9, row=3+row_adj)
    label3_m_3.grid(column=10,row=3+row_adj)
    year3_3_entry.grid(column=11, row=3+row_adj)
    rad3_A_3.grid(column=12, row=3+row_adj, padx=15, pady=10)
    lbl3_A_3.grid(column=13, row=3+row_adj, pady=10)
    spin3_A_3.grid(column=14,row=3+row_adj, pady=10)
    label3_h1_3.grid(column=15,row=3+row_adj, pady=10)
    spin3_B_3.grid(column=16,row=3+row_adj, pady=10)
    label3_m1_3.grid(column=17,row=3+row_adj, pady=10)
    lbl3_B_3.grid(column=18, row=3+row_adj, pady=10)
    spin3_C_3.grid(column=19,row=3+row_adj, pady=10)
    label3_h2_3.grid(column=20,row=3+row_adj, pady=10)
    spin3_D_3.grid(column=21,row=3+row_adj, pady=10)
    label3_m2_3.grid(column=22,row=3+row_adj, pady=10)
    rad3_B_3.grid(column=23, row=3+row_adj, padx=15, pady=10)
    rad3_C_3.grid(column=24, row=3+row_adj, pady=10)

    btn3.grid(column=25, row=4+row_adj, padx=25, pady=10)

    # Box4
    btn4 = Button(tab4, text="Set", command=getBox4Schedule)
    tab4_title = Label(tab4, text= 'LED schedule', anchor='center')
    tab4_title.grid(column=0, row= -1+row_adj, columnspan='20', sticky='we')
    capSep4 = ttk.Separator(tab4, orient=HORIZONTAL)
    capSep4.grid(column=0, row = -2+row_adj, columnspan='20', sticky='we')
        # phase 1
    phaseLabel4_1=Label(tab4, text='Phase 1')
    rad4_A_1 = Radiobutton(tab4, text='LD', variable=var4_1, value=1)
    lbl4_A_1 = Label(tab4, text= 'On:')
    spin4_A_1 = Spinbox(tab4, from_=00, to=24, width=2)
    spin4_B_1 = Spinbox(tab4, from_=00, to=59, width=2)
    spin4_A_1.delete(0,"end")
    spin4_A_1.insert(0,"07")
    spin4_B_1.delete(0,"end")
    spin4_B_1.insert(0,"00")
    label4_h1_1 = Label(tab4, text='h')
    label4_m1_1 = Label(tab4, text='m')
    lbl4_B_1 = Label(tab4, text= 'Off:')
    spin4_C_1 = Spinbox(tab4, from_=0, to=24, width=2)
    spin4_D_1 = Spinbox(tab4, from_=00, to=59, width=2)
    spin4_C_1.delete(0,"end")
    spin4_C_1.insert(0,"19")
    spin4_D_1.delete(0,"end")
    spin4_D_1.insert(0,"00")
    label4_h2_1 = Label(tab4, text='h')
    label4_m2_1 = Label(tab4, text='m')
    rad4_B_1 = Radiobutton(tab4, text='DD', variable=var4_1, value=2)
    rad4_C_1 = Radiobutton(tab4, text='LL', variable=var4_1, value=3)

    phaseLabel4_1.grid(column=0, row=1+row_adj, padx=15, pady=10)

    rad4_A_1.grid(column=12, row=1+row_adj, padx=15, pady=10)
    lbl4_A_1.grid(column=13, row=1+row_adj, pady=10)
    spin4_A_1.grid(column=14,row=1+row_adj, pady=10)
    label4_h1_1.grid(column=15,row=1+row_adj, pady=10, sticky='w')
    spin4_B_1.grid(column=16,row=1+row_adj, pady=10)
    label4_m1_1.grid(column=17,row=1+row_adj, pady=10, sticky='w')
    lbl4_B_1.grid(column=18, row=1+row_adj, pady=10)
    spin4_C_1.grid(column=19,row=1+row_adj, pady=10)
    label4_h2_1.grid(column=20,row=1+row_adj, pady=10, sticky='w')
    spin4_D_1.grid(column=21,row=1+row_adj, pady=10)
    label4_m2_1.grid(column=22,row=1+row_adj, pady=10, sticky='w')
    rad4_B_1.grid(column=23, row=1+row_adj, padx=15, pady=10)
    rad4_C_1.grid(column=24, row=1+row_adj, pady=10)

        # phase 2
    phaseLabel4_2=Label(tab4, text='Phase 2')
    fromLabel4_2=Label(tab4, text='From:')
    space4_2=Label(tab4, text=" ")
    spin4_E_2 = Spinbox(tab4, from_=00, to=24, width=2)
    spin4_F_2 = Spinbox(tab4, from_=00, to=59, width=2)
    spin4_E_2.delete(0,"end")
    spin4_E_2.insert(0,"07")
    spin4_F_2.delete(0,"end")
    spin4_F_2.insert(0,"00")
    label4_h0_2 = Label(tab4, text='h')
    label4_m0_2 = Label(tab4, text='m')
    date4_2_entry = Spinbox(tab4, from_=00, to=31, width=4) 
    month4_2_entry = Spinbox(tab4, from_=00, to=12, width=4)
    year4_2_entry = Spinbox(tab4, from_=2018, to=2030, width=6) 
    date4_2_entry.delete(0,"end")
    date4_2_entry.insert(0,"DD")
    month4_2_entry.delete(0,"end")
    month4_2_entry.insert(0,"MM")
    year4_2_entry.delete(0,"end")
    year4_2_entry.insert(0,"YYYY")
    label4_d_2=Label(tab4, text= '/')
    label4_m_2=Label(tab4, text= '/')
    rad4_A_2 = Radiobutton(tab4, text='LD', variable=var4_2, value=1)
    lbl4_A_2 = Label(tab4, text= 'On:')
    spin4_A_2 = Spinbox(tab4, from_=00, to=24, width=2)
    spin4_B_2 = Spinbox(tab4, from_=00, to=59, width=2)
    spin4_A_2.delete(0,"end")
    spin4_A_2.insert(0,"07")
    spin4_B_2.delete(0,"end")
    spin4_B_2.insert(0,"00")
    label4_h1_2 = Label(tab4, text='h')
    label4_m1_2 = Label(tab4, text='m')
    lbl4_B_2 = Label(tab4, text= 'Off:')
    spin4_C_2 = Spinbox(tab4, from_=0, to=24, width=2)
    spin4_D_2 = Spinbox(tab4, from_=00, to=59, width=2)
    spin4_C_2.delete(0,"end")
    spin4_C_2.insert(0,"19")
    spin4_D_2.delete(0,"end")
    spin4_D_2.insert(0,"00")
    label4_h2_2 = Label(tab4, text='h')
    label4_m2_2 = Label(tab4, text='m')
    rad4_B_2 = Radiobutton(tab4, text='DD', variable=var4_2, value=2)
    rad4_C_2 = Radiobutton(tab4, text='LL', variable=var4_2, value=3)

    phaseLabel4_2.grid(column=0, row=2+row_adj, padx=15, pady=10)
    fromLabel4_2.grid(column=1,row=2+row_adj)
    spin4_E_2.grid(column=2,row=2+row_adj)
    label4_h0_2.grid(column=3,row=2+row_adj)
    spin4_F_2.grid(column=4,row=2+row_adj)
    label4_m0_2.grid(column=5,row=2+row_adj)
    space4_2.grid(column=6,row=2+row_adj,padx=5)
    date4_2_entry.grid(column=7, row=2+row_adj)
    label4_d_2.grid(column=8,row=2+row_adj)
    month4_2_entry.grid(column=9, row=2+row_adj)
    label4_m_2.grid(column=10,row=2+row_adj)
    year4_2_entry.grid(column=11, row=2+row_adj)
    rad4_A_2.grid(column=12, row=2+row_adj, padx=15, pady=10)
    lbl4_A_2.grid(column=13, row=2+row_adj, pady=10)
    spin4_A_2.grid(column=14,row=2+row_adj, pady=10)
    label4_h1_2.grid(column=15,row=2+row_adj, pady=10)
    spin4_B_2.grid(column=16,row=2+row_adj, pady=10)
    label4_m1_2.grid(column=17,row=2+row_adj, pady=10)
    lbl4_B_2.grid(column=18, row=2+row_adj, pady=10)
    spin4_C_2.grid(column=19,row=2+row_adj, pady=10)
    label4_h2_2.grid(column=20,row=2+row_adj, pady=10)
    spin4_D_2.grid(column=21,row=2+row_adj, pady=10)
    label4_m2_2.grid(column=22,row=2+row_adj, pady=10)
    rad4_B_2.grid(column=23, row=2+row_adj, padx=15, pady=10)
    rad4_C_2.grid(column=24, row=2+row_adj, pady=10)
        # phase 3
    phaseLabel4_3=Label(tab4, text='Phase 3')
    fromLabel4_3=Label(tab4, text='From:')
    space4_3=Label(tab4, text=" ")
    spin4_E_3 = Spinbox(tab4, from_=00, to=24, width=2)
    spin4_F_3 = Spinbox(tab4, from_=00, to=59, width=2)
    spin4_E_3.delete(0,"end")
    spin4_E_3.insert(0,"07")
    spin4_F_3.delete(0,"end")
    spin4_F_3.insert(0,"00")
    label4_h0_3 = Label(tab4, text='h')
    label4_m0_3 = Label(tab4, text='m')
    date4_3_entry = Spinbox(tab4, from_=00, to=31, width=4) 
    month4_3_entry = Spinbox(tab4, from_=00, to=12, width=4)
    year4_3_entry = Spinbox(tab4, from_=2018, to=2030, width=6) 
    date4_3_entry.delete(0,"end")
    date4_3_entry.insert(0,"DD")
    month4_3_entry.delete(0,"end")
    month4_3_entry.insert(0,"MM")
    year4_3_entry.delete(0,"end")
    year4_3_entry.insert(0,"YYYY")
    label4_d_3=Label(tab4, text= '/')
    label4_m_3=Label(tab4, text= '/')
    rad4_A_3 = Radiobutton(tab4, text='LD', variable=var4_3, value=1)
    lbl4_A_3 = Label(tab4, text= 'On:')
    spin4_A_3 = Spinbox(tab4, from_=00, to=24, width=2)
    spin4_B_3 = Spinbox(tab4, from_=00, to=59, width=2)
    spin4_A_3.delete(0,"end")
    spin4_A_3.insert(0,"07")
    spin4_B_3.delete(0,"end")
    spin4_B_3.insert(0,"00")
    label4_h1_3 = Label(tab4, text='h')
    label4_m1_3 = Label(tab4, text='m')
    lbl4_B_3 = Label(tab4, text= 'Off:')
    spin4_C_3 = Spinbox(tab4, from_=0, to=24, width=2)
    spin4_D_3 = Spinbox(tab4, from_=00, to=59, width=2)
    spin4_C_3.delete(0,"end")
    spin4_C_3.insert(0,"19")
    spin4_D_3.delete(0,"end")
    spin4_D_3.insert(0,"00")
    label4_h2_3 = Label(tab4, text='h')
    label4_m2_3 = Label(tab4, text='m')
    rad4_B_3 = Radiobutton(tab4, text='DD', variable=var4_3, value=2)
    rad4_C_3 = Radiobutton(tab4, text='LL', variable=var4_3, value=3)

    phaseLabel4_3.grid(column=0, row=3+row_adj, padx=15, pady=10)
    fromLabel4_3.grid(column=1,row=3+row_adj)
    spin4_E_3.grid(column=2,row=3+row_adj)
    label4_h0_3.grid(column=3,row=3+row_adj)
    spin4_F_3.grid(column=4,row=3+row_adj)
    label4_m0_3.grid(column=5,row=3+row_adj)
    space4_3.grid(column=6,row=3+row_adj,padx=5)
    date4_3_entry.grid(column=7, row=3+row_adj)
    label4_d_3.grid(column=8,row=3+row_adj)
    month4_3_entry.grid(column=9, row=3+row_adj)
    label4_m_3.grid(column=10,row=3+row_adj)
    year4_3_entry.grid(column=11, row=3+row_adj)
    rad4_A_3.grid(column=12, row=3+row_adj, padx=15, pady=10)
    lbl4_A_3.grid(column=13, row=3+row_adj, pady=10)
    spin4_A_3.grid(column=14,row=3+row_adj, pady=10)
    label4_h1_3.grid(column=15,row=3+row_adj, pady=10)
    spin4_B_3.grid(column=16,row=3+row_adj, pady=10)
    label4_m1_3.grid(column=17,row=3+row_adj, pady=10)
    lbl4_B_3.grid(column=18, row=3+row_adj, pady=10)
    spin4_C_3.grid(column=19,row=3+row_adj, pady=10)
    label4_h2_3.grid(column=20,row=3+row_adj, pady=10)
    spin4_D_3.grid(column=21,row=3+row_adj, pady=10)
    label4_m2_3.grid(column=22,row=3+row_adj, pady=10)
    rad4_B_3.grid(column=23, row=3+row_adj, padx=15, pady=10)
    rad4_C_3.grid(column=24, row=3+row_adj, pady=10)

    btn4.grid(column=25, row=4+row_adj, padx=25, pady=10)

    # Box5
    btn5 = Button(tab5, text="Set", command=getBox5Schedule)
    tab5_title = Label(tab5, text= 'LED schedule', anchor='center')
    tab5_title.grid(column=0, row= -1+row_adj, columnspan='20', sticky='we')
    capSep5 = ttk.Separator(tab5, orient=HORIZONTAL)
    capSep5.grid(column=0, row = -2+row_adj, columnspan='20', sticky='we')
        # phase 1
    phaseLabel5_1=Label(tab5, text='Phase 1')
    rad5_A_1 = Radiobutton(tab5, text='LD', variable=var5_1, value=1)
    lbl5_A_1 = Label(tab5, text= 'On:')
    spin5_A_1 = Spinbox(tab5, from_=00, to=24, width=2)
    spin5_B_1 = Spinbox(tab5, from_=00, to=59, width=2)
    spin5_A_1.delete(0,"end")
    spin5_A_1.insert(0,"07")
    spin5_B_1.delete(0,"end")
    spin5_B_1.insert(0,"00")
    label5_h1_1 = Label(tab5, text='h')
    label5_m1_1 = Label(tab5, text='m')
    lbl5_B_1 = Label(tab5, text= 'Off:')
    spin5_C_1 = Spinbox(tab5, from_=0, to=24, width=2)
    spin5_D_1 = Spinbox(tab5, from_=00, to=59, width=2)
    spin5_C_1.delete(0,"end")
    spin5_C_1.insert(0,"19")
    spin5_D_1.delete(0,"end")
    spin5_D_1.insert(0,"00")
    label5_h2_1 = Label(tab5, text='h')
    label5_m2_1 = Label(tab5, text='m')
    rad5_B_1 = Radiobutton(tab5, text='DD', variable=var5_1, value=2)
    rad5_C_1 = Radiobutton(tab5, text='LL', variable=var5_1, value=3)

    phaseLabel5_1.grid(column=0, row=1+row_adj, padx=15, pady=10)

    rad5_A_1.grid(column=12, row=1+row_adj, padx=15, pady=10)
    lbl5_A_1.grid(column=13, row=1+row_adj, pady=10)
    spin5_A_1.grid(column=14,row=1+row_adj, pady=10)
    label5_h1_1.grid(column=15,row=1+row_adj, pady=10, sticky='w')
    spin5_B_1.grid(column=16,row=1+row_adj, pady=10)
    label5_m1_1.grid(column=17,row=1+row_adj, pady=10, sticky='w')
    lbl5_B_1.grid(column=18, row=1+row_adj, pady=10)
    spin5_C_1.grid(column=19,row=1+row_adj, pady=10)
    label5_h2_1.grid(column=20,row=1+row_adj, pady=10, sticky='w')
    spin5_D_1.grid(column=21,row=1+row_adj, pady=10)
    label5_m2_1.grid(column=22,row=1+row_adj, pady=10, sticky='w')
    rad5_B_1.grid(column=23, row=1+row_adj, padx=15, pady=10)
    rad5_C_1.grid(column=24, row=1+row_adj, pady=10)

        # phase 2
    phaseLabel5_2=Label(tab5, text='Phase 2')
    fromLabel5_2=Label(tab5, text='From:')
    space5_2=Label(tab5, text=" ")
    spin5_E_2 = Spinbox(tab5, from_=00, to=24, width=2)
    spin5_F_2 = Spinbox(tab5, from_=00, to=59, width=2)
    spin5_E_2.delete(0,"end")
    spin5_E_2.insert(0,"07")
    spin5_F_2.delete(0,"end")
    spin5_F_2.insert(0,"00")
    label5_h0_2 = Label(tab5, text='h')
    label5_m0_2 = Label(tab5, text='m')
    date5_2_entry = Spinbox(tab5, from_=00, to=31, width=4) 
    month5_2_entry = Spinbox(tab5, from_=00, to=12, width=4)
    year5_2_entry = Spinbox(tab5, from_=2018, to=2030, width=6) 
    date5_2_entry.delete(0,"end")
    date5_2_entry.insert(0,"DD")
    month5_2_entry.delete(0,"end")
    month5_2_entry.insert(0,"MM")
    year5_2_entry.delete(0,"end")
    year5_2_entry.insert(0,"YYYY")
    label5_d_2=Label(tab5, text= '/')
    label5_m_2=Label(tab5, text= '/')
    rad5_A_2 = Radiobutton(tab5, text='LD', variable=var5_2, value=1)
    lbl5_A_2 = Label(tab5, text= 'On:')
    spin5_A_2 = Spinbox(tab5, from_=00, to=24, width=2)
    spin5_B_2 = Spinbox(tab5, from_=00, to=59, width=2)
    spin5_A_2.delete(0,"end")
    spin5_A_2.insert(0,"07")
    spin5_B_2.delete(0,"end")
    spin5_B_2.insert(0,"00")
    label5_h1_2 = Label(tab5, text='h')
    label5_m1_2 = Label(tab5, text='m')
    lbl5_B_2 = Label(tab5, text= 'Off:')
    spin5_C_2 = Spinbox(tab5, from_=0, to=24, width=2)
    spin5_D_2 = Spinbox(tab5, from_=00, to=59, width=2)
    spin5_C_2.delete(0,"end")
    spin5_C_2.insert(0,"19")
    spin5_D_2.delete(0,"end")
    spin5_D_2.insert(0,"00")
    label5_h2_2 = Label(tab5, text='h')
    label5_m2_2 = Label(tab5, text='m')
    rad5_B_2 = Radiobutton(tab5, text='DD', variable=var5_2, value=2)
    rad5_C_2 = Radiobutton(tab5, text='LL', variable=var5_2, value=3)

    phaseLabel5_2.grid(column=0, row=2+row_adj, padx=15, pady=10)
    fromLabel5_2.grid(column=1,row=2+row_adj)
    spin5_E_2.grid(column=2,row=2+row_adj)
    label5_h0_2.grid(column=3,row=2+row_adj)
    spin5_F_2.grid(column=4,row=2+row_adj)
    label5_m0_2.grid(column=5,row=2+row_adj)
    space5_2.grid(column=6,row=2+row_adj,padx=5)
    date5_2_entry.grid(column=7, row=2+row_adj)
    label5_d_2.grid(column=8,row=2+row_adj)
    month5_2_entry.grid(column=9, row=2+row_adj)
    label5_m_2.grid(column=10,row=2+row_adj)
    year5_2_entry.grid(column=11, row=2+row_adj)
    rad5_A_2.grid(column=12, row=2+row_adj, padx=15, pady=10)
    lbl5_A_2.grid(column=13, row=2+row_adj, pady=10)
    spin5_A_2.grid(column=14,row=2+row_adj, pady=10)
    label5_h1_2.grid(column=15,row=2+row_adj, pady=10)
    spin5_B_2.grid(column=16,row=2+row_adj, pady=10)
    label5_m1_2.grid(column=17,row=2+row_adj, pady=10)
    lbl5_B_2.grid(column=18, row=2+row_adj, pady=10)
    spin5_C_2.grid(column=19,row=2+row_adj, pady=10)
    label5_h2_2.grid(column=20,row=2+row_adj, pady=10)
    spin5_D_2.grid(column=21,row=2+row_adj, pady=10)
    label5_m2_2.grid(column=22,row=2+row_adj, pady=10)
    rad5_B_2.grid(column=23, row=2+row_adj, padx=15, pady=10)
    rad5_C_2.grid(column=24, row=2+row_adj, pady=10)
        # phase 3
    phaseLabel5_3=Label(tab5, text='Phase 3')
    fromLabel5_3=Label(tab5, text='From:')
    space5_3=Label(tab5, text=" ")
    spin5_E_3 = Spinbox(tab5, from_=00, to=24, width=2)
    spin5_F_3 = Spinbox(tab5, from_=00, to=59, width=2)
    spin5_E_3.delete(0,"end")
    spin5_E_3.insert(0,"07")
    spin5_F_3.delete(0,"end")
    spin5_F_3.insert(0,"00")
    label5_h0_3 = Label(tab5, text='h')
    label5_m0_3 = Label(tab5, text='m')
    date5_3_entry = Spinbox(tab5, from_=00, to=31, width=4) 
    month5_3_entry = Spinbox(tab5, from_=00, to=12, width=4)
    year5_3_entry = Spinbox(tab5, from_=2018, to=2030, width=6) 
    date5_3_entry.delete(0,"end")
    date5_3_entry.insert(0,"DD")
    month5_3_entry.delete(0,"end")
    month5_3_entry.insert(0,"MM")
    year5_3_entry.delete(0,"end")
    year5_3_entry.insert(0,"YYYY")
    label5_d_3=Label(tab5, text= '/')
    label5_m_3=Label(tab5, text= '/')
    rad5_A_3 = Radiobutton(tab5, text='LD', variable=var5_3, value=1)
    lbl5_A_3 = Label(tab5, text= 'On:')
    spin5_A_3 = Spinbox(tab5, from_=00, to=24, width=2)
    spin5_B_3 = Spinbox(tab5, from_=00, to=59, width=2)
    spin5_A_3.delete(0,"end")
    spin5_A_3.insert(0,"07")
    spin5_B_3.delete(0,"end")
    spin5_B_3.insert(0,"00")
    label5_h1_3 = Label(tab5, text='h')
    label5_m1_3 = Label(tab5, text='m')
    lbl5_B_3 = Label(tab5, text= 'Off:')
    spin5_C_3 = Spinbox(tab5, from_=0, to=24, width=2)
    spin5_D_3 = Spinbox(tab5, from_=00, to=59, width=2)
    spin5_C_3.delete(0,"end")
    spin5_C_3.insert(0,"19")
    spin5_D_3.delete(0,"end")
    spin5_D_3.insert(0,"00")
    label5_h2_3 = Label(tab5, text='h')
    label5_m2_3 = Label(tab5, text='m')
    rad5_B_3 = Radiobutton(tab5, text='DD', variable=var5_3, value=2)
    rad5_C_3 = Radiobutton(tab5, text='LL', variable=var5_3, value=3)

    phaseLabel5_3.grid(column=0, row=3+row_adj, padx=15, pady=10)
    fromLabel5_3.grid(column=1,row=3+row_adj)
    spin5_E_3.grid(column=2,row=3+row_adj)
    label5_h0_3.grid(column=3,row=3+row_adj)
    spin5_F_3.grid(column=4,row=3+row_adj)
    label5_m0_3.grid(column=5,row=3+row_adj)
    space5_3.grid(column=6,row=3+row_adj,padx=5)
    date5_3_entry.grid(column=7, row=3+row_adj)
    label5_d_3.grid(column=8,row=3+row_adj)
    month5_3_entry.grid(column=9, row=3+row_adj)
    label5_m_3.grid(column=10,row=3+row_adj)
    year5_3_entry.grid(column=11, row=3+row_adj)
    rad5_A_3.grid(column=12, row=3+row_adj, padx=15, pady=10)
    lbl5_A_3.grid(column=13, row=3+row_adj, pady=10)
    spin5_A_3.grid(column=14,row=3+row_adj, pady=10)
    label5_h1_3.grid(column=15,row=3+row_adj, pady=10)
    spin5_B_3.grid(column=16,row=3+row_adj, pady=10)
    label5_m1_3.grid(column=17,row=3+row_adj, pady=10)
    lbl5_B_3.grid(column=18, row=3+row_adj, pady=10)
    spin5_C_3.grid(column=19,row=3+row_adj, pady=10)
    label5_h2_3.grid(column=20,row=3+row_adj, pady=10)
    spin5_D_3.grid(column=21,row=3+row_adj, pady=10)
    label5_m2_3.grid(column=22,row=3+row_adj, pady=10)
    rad5_B_3.grid(column=23, row=3+row_adj, padx=15, pady=10)
    rad5_C_3.grid(column=24, row=3+row_adj, pady=10)

    btn5.grid(column=25, row=4+row_adj, padx=25, pady=10)


    # Box6
    btn6 = Button(tab6, text="Set", command=getBox6Schedule)
    tab6_title = Label(tab6, text= 'LED schedule', anchor='center')
    tab6_title.grid(column=0, row= -1+row_adj, columnspan='20', sticky='we')
    capSep6 = ttk.Separator(tab6, orient=HORIZONTAL)
    capSep6.grid(column=0, row = -2+row_adj, columnspan='20', sticky='we')
        # phase 1
    phaseLabel6_1=Label(tab6, text='Phase 1')
    rad6_A_1 = Radiobutton(tab6, text='LD', variable=var6_1, value=1)
    lbl6_A_1 = Label(tab6, text= 'On:')
    spin6_A_1 = Spinbox(tab6, from_=00, to=24, width=2)
    spin6_B_1 = Spinbox(tab6, from_=00, to=59, width=2)
    spin6_A_1.delete(0,"end")
    spin6_A_1.insert(0,"07")
    spin6_B_1.delete(0,"end")
    spin6_B_1.insert(0,"00")
    label6_h1_1 = Label(tab6, text='h')
    label6_m1_1 = Label(tab6, text='m')
    lbl6_B_1 = Label(tab6, text= 'Off:')
    spin6_C_1 = Spinbox(tab6, from_=0, to=24, width=2)
    spin6_D_1 = Spinbox(tab6, from_=00, to=59, width=2)
    spin6_C_1.delete(0,"end")
    spin6_C_1.insert(0,"19")
    spin6_D_1.delete(0,"end")
    spin6_D_1.insert(0,"00")
    label6_h2_1 = Label(tab6, text='h')
    label6_m2_1 = Label(tab6, text='m')
    rad6_B_1 = Radiobutton(tab6, text='DD', variable=var6_1, value=2)
    rad6_C_1 = Radiobutton(tab6, text='LL', variable=var6_1, value=3)

    phaseLabel6_1.grid(column=0, row=1+row_adj, padx=15, pady=10)

    rad6_A_1.grid(column=12, row=1+row_adj, padx=15, pady=10)
    lbl6_A_1.grid(column=13, row=1+row_adj, pady=10)
    spin6_A_1.grid(column=14,row=1+row_adj, pady=10)
    label6_h1_1.grid(column=15,row=1+row_adj, pady=10, sticky='w')
    spin6_B_1.grid(column=16,row=1+row_adj, pady=10)
    label6_m1_1.grid(column=17,row=1+row_adj, pady=10, sticky='w')
    lbl6_B_1.grid(column=18, row=1+row_adj, pady=10)
    spin6_C_1.grid(column=19,row=1+row_adj, pady=10)
    label6_h2_1.grid(column=20,row=1+row_adj, pady=10, sticky='w')
    spin6_D_1.grid(column=21,row=1+row_adj, pady=10)
    label6_m2_1.grid(column=22,row=1+row_adj, pady=10, sticky='w')
    rad6_B_1.grid(column=23, row=1+row_adj, padx=15, pady=10)
    rad6_C_1.grid(column=24, row=1+row_adj, pady=10)

        # phase 2
    phaseLabel6_2=Label(tab6, text='Phase 2')
    fromLabel6_2=Label(tab6, text='From:')
    space6_2=Label(tab6, text=" ")
    spin6_E_2 = Spinbox(tab6, from_=00, to=24, width=2)
    spin6_F_2 = Spinbox(tab6, from_=00, to=59, width=2)
    spin6_E_2.delete(0,"end")
    spin6_E_2.insert(0,"07")
    spin6_F_2.delete(0,"end")
    spin6_F_2.insert(0,"00")
    label6_h0_2 = Label(tab6, text='h')
    label6_m0_2 = Label(tab6, text='m')
    date6_2_entry = Spinbox(tab6, from_=00, to=31, width=4) 
    month6_2_entry = Spinbox(tab6, from_=00, to=12, width=4)
    year6_2_entry = Spinbox(tab6, from_=2018, to=2030, width=6) 
    date6_2_entry.delete(0,"end")
    date6_2_entry.insert(0,"DD")
    month6_2_entry.delete(0,"end")
    month6_2_entry.insert(0,"MM")
    year6_2_entry.delete(0,"end")
    year6_2_entry.insert(0,"YYYY")
    label6_d_2=Label(tab6, text= '/')
    label6_m_2=Label(tab6, text= '/')
    rad6_A_2 = Radiobutton(tab6, text='LD', variable=var6_2, value=1)
    lbl6_A_2 = Label(tab6, text= 'On:')
    spin6_A_2 = Spinbox(tab6, from_=00, to=24, width=2)
    spin6_B_2 = Spinbox(tab6, from_=00, to=59, width=2)
    spin6_A_2.delete(0,"end")
    spin6_A_2.insert(0,"07")
    spin6_B_2.delete(0,"end")
    spin6_B_2.insert(0,"00")
    label6_h1_2 = Label(tab6, text='h')
    label6_m1_2 = Label(tab6, text='m')
    lbl6_B_2 = Label(tab6, text= 'Off:')
    spin6_C_2 = Spinbox(tab6, from_=0, to=24, width=2)
    spin6_D_2 = Spinbox(tab6, from_=00, to=59, width=2)
    spin6_C_2.delete(0,"end")
    spin6_C_2.insert(0,"19")
    spin6_D_2.delete(0,"end")
    spin6_D_2.insert(0,"00")
    label6_h2_2 = Label(tab6, text='h')
    label6_m2_2 = Label(tab6, text='m')
    rad6_B_2 = Radiobutton(tab6, text='DD', variable=var6_2, value=2)
    rad6_C_2 = Radiobutton(tab6, text='LL', variable=var6_2, value=3)

    phaseLabel6_2.grid(column=0, row=2+row_adj, padx=15, pady=10)
    fromLabel6_2.grid(column=1,row=2+row_adj)
    spin6_E_2.grid(column=2,row=2+row_adj)
    label6_h0_2.grid(column=3,row=2+row_adj)
    spin6_F_2.grid(column=4,row=2+row_adj)
    label6_m0_2.grid(column=5,row=2+row_adj)
    space6_2.grid(column=6,row=2+row_adj,padx=5)
    date6_2_entry.grid(column=7, row=2+row_adj)
    label6_d_2.grid(column=8,row=2+row_adj)
    month6_2_entry.grid(column=9, row=2+row_adj)
    label6_m_2.grid(column=10,row=2+row_adj)
    year6_2_entry.grid(column=11, row=2+row_adj)
    rad6_A_2.grid(column=12, row=2+row_adj, padx=15, pady=10)
    lbl6_A_2.grid(column=13, row=2+row_adj, pady=10)
    spin6_A_2.grid(column=14,row=2+row_adj, pady=10)
    label6_h1_2.grid(column=15,row=2+row_adj, pady=10)
    spin6_B_2.grid(column=16,row=2+row_adj, pady=10)
    label6_m1_2.grid(column=17,row=2+row_adj, pady=10)
    lbl6_B_2.grid(column=18, row=2+row_adj, pady=10)
    spin6_C_2.grid(column=19,row=2+row_adj, pady=10)
    label6_h2_2.grid(column=20,row=2+row_adj, pady=10)
    spin6_D_2.grid(column=21,row=2+row_adj, pady=10)
    label6_m2_2.grid(column=22,row=2+row_adj, pady=10)
    rad6_B_2.grid(column=23, row=2+row_adj, padx=15, pady=10)
    rad6_C_2.grid(column=24, row=2+row_adj, pady=10)
        # phase 3
    phaseLabel6_3=Label(tab6, text='Phase 3')
    fromLabel6_3=Label(tab6, text='From:')
    space6_3=Label(tab6, text=" ")
    spin6_E_3 = Spinbox(tab6, from_=00, to=24, width=2)
    spin6_F_3 = Spinbox(tab6, from_=00, to=59, width=2)
    spin6_E_3.delete(0,"end")
    spin6_E_3.insert(0,"07")
    spin6_F_3.delete(0,"end")
    spin6_F_3.insert(0,"00")
    label6_h0_3 = Label(tab6, text='h')
    label6_m0_3 = Label(tab6, text='m')
    date6_3_entry = Spinbox(tab6, from_=00, to=31, width=4) 
    month6_3_entry = Spinbox(tab6, from_=00, to=12, width=4)
    year6_3_entry = Spinbox(tab6, from_=2018, to=2030, width=6) 
    date6_3_entry.delete(0,"end")
    date6_3_entry.insert(0,"DD")
    month6_3_entry.delete(0,"end")
    month6_3_entry.insert(0,"MM")
    year6_3_entry.delete(0,"end")
    year6_3_entry.insert(0,"YYYY")
    label6_d_3=Label(tab6, text= '/')
    label6_m_3=Label(tab6, text= '/')
    rad6_A_3 = Radiobutton(tab6, text='LD', variable=var6_3, value=1)
    lbl6_A_3 = Label(tab6, text= 'On:')
    spin6_A_3 = Spinbox(tab6, from_=00, to=24, width=2)
    spin6_B_3 = Spinbox(tab6, from_=00, to=59, width=2)
    spin6_A_3.delete(0,"end")
    spin6_A_3.insert(0,"07")
    spin6_B_3.delete(0,"end")
    spin6_B_3.insert(0,"00")
    label6_h1_3 = Label(tab6, text='h')
    label6_m1_3 = Label(tab6, text='m')
    lbl6_B_3 = Label(tab6, text= 'Off:')
    spin6_C_3 = Spinbox(tab6, from_=0, to=24, width=2)
    spin6_D_3 = Spinbox(tab6, from_=00, to=59, width=2)
    spin6_C_3.delete(0,"end")
    spin6_C_3.insert(0,"19")
    spin6_D_3.delete(0,"end")
    spin6_D_3.insert(0,"00")
    label6_h2_3 = Label(tab6, text='h')
    label6_m2_3 = Label(tab6, text='m')
    rad6_B_3 = Radiobutton(tab6, text='DD', variable=var6_3, value=2)
    rad6_C_3 = Radiobutton(tab6, text='LL', variable=var6_3, value=3)

    phaseLabel6_3.grid(column=0, row=3+row_adj, padx=15, pady=10)
    fromLabel6_3.grid(column=1,row=3+row_adj)
    spin6_E_3.grid(column=2,row=3+row_adj)
    label6_h0_3.grid(column=3,row=3+row_adj)
    spin6_F_3.grid(column=4,row=3+row_adj)
    label6_m0_3.grid(column=5,row=3+row_adj)
    space6_3.grid(column=6,row=3+row_adj,padx=5)
    date6_3_entry.grid(column=7, row=3+row_adj)
    label6_d_3.grid(column=8,row=3+row_adj)
    month6_3_entry.grid(column=9, row=3+row_adj)
    label6_m_3.grid(column=10,row=3+row_adj)
    year6_3_entry.grid(column=11, row=3+row_adj)
    rad6_A_3.grid(column=12, row=3+row_adj, padx=15, pady=10)
    lbl6_A_3.grid(column=13, row=3+row_adj, pady=10)
    spin6_A_3.grid(column=14,row=3+row_adj, pady=10)
    label6_h1_3.grid(column=15,row=3+row_adj, pady=10)
    spin6_B_3.grid(column=16,row=3+row_adj, pady=10)
    label6_m1_3.grid(column=17,row=3+row_adj, pady=10)
    lbl6_B_3.grid(column=18, row=3+row_adj, pady=10)
    spin6_C_3.grid(column=19,row=3+row_adj, pady=10)
    label6_h2_3.grid(column=20,row=3+row_adj, pady=10)
    spin6_D_3.grid(column=21,row=3+row_adj, pady=10)
    label6_m2_3.grid(column=22,row=3+row_adj, pady=10)
    rad6_B_3.grid(column=23, row=3+row_adj, padx=15, pady=10)
    rad6_C_3.grid(column=24, row=3+row_adj, pady=10)

    btn6.grid(column=25, row=4+row_adj, padx=25, pady=10)

    # Box7
    btn7 = Button(tab7, text="Set", command=getBox7Schedule)
    tab7_title = Label(tab7, text= 'LED schedule', anchor='center')
    tab7_title.grid(column=0, row= -1+row_adj, columnspan='20', sticky='we')
    capSep7 = ttk.Separator(tab7, orient=HORIZONTAL)
    capSep7.grid(column=0, row = -2+row_adj, columnspan='20', sticky='we')
        # phase 1
    phaseLabel7_1=Label(tab7, text='Phase 1')
    rad7_A_1 = Radiobutton(tab7, text='LD', variable=var7_1, value=1)
    lbl7_A_1 = Label(tab7, text= 'On:')
    spin7_A_1 = Spinbox(tab7, from_=00, to=24, width=2)
    spin7_B_1 = Spinbox(tab7, from_=00, to=59, width=2)
    spin7_A_1.delete(0,"end")
    spin7_A_1.insert(0,"07")
    spin7_B_1.delete(0,"end")
    spin7_B_1.insert(0,"00")
    label7_h1_1 = Label(tab7, text='h')
    label7_m1_1 = Label(tab7, text='m')
    lbl7_B_1 = Label(tab7, text= 'Off:')
    spin7_C_1 = Spinbox(tab7, from_=0, to=24, width=2)
    spin7_D_1 = Spinbox(tab7, from_=00, to=59, width=2)
    spin7_C_1.delete(0,"end")
    spin7_C_1.insert(0,"19")
    spin7_D_1.delete(0,"end")
    spin7_D_1.insert(0,"00")
    label7_h2_1 = Label(tab7, text='h')
    label7_m2_1 = Label(tab7, text='m')
    rad7_B_1 = Radiobutton(tab7, text='DD', variable=var7_1, value=2)
    rad7_C_1 = Radiobutton(tab7, text='LL', variable=var7_1, value=3)

    phaseLabel7_1.grid(column=0, row=1+row_adj, padx=15, pady=10)

    rad7_A_1.grid(column=12, row=1+row_adj, padx=15, pady=10)
    lbl7_A_1.grid(column=13, row=1+row_adj, pady=10)
    spin7_A_1.grid(column=14,row=1+row_adj, pady=10)
    label7_h1_1.grid(column=15,row=1+row_adj, pady=10, sticky='w')
    spin7_B_1.grid(column=16,row=1+row_adj, pady=10)
    label7_m1_1.grid(column=17,row=1+row_adj, pady=10, sticky='w')
    lbl7_B_1.grid(column=18, row=1+row_adj, pady=10)
    spin7_C_1.grid(column=19,row=1+row_adj, pady=10)
    label7_h2_1.grid(column=20,row=1+row_adj, pady=10, sticky='w')
    spin7_D_1.grid(column=21,row=1+row_adj, pady=10)
    label7_m2_1.grid(column=22,row=1+row_adj, pady=10, sticky='w')
    rad7_B_1.grid(column=23, row=1+row_adj, padx=15, pady=10)
    rad7_C_1.grid(column=24, row=1+row_adj, pady=10)

        # phase 2
    phaseLabel7_2=Label(tab7, text='Phase 2')
    fromLabel7_2=Label(tab7, text='From:')
    space7_2=Label(tab7, text=" ")
    spin7_E_2 = Spinbox(tab7, from_=00, to=24, width=2)
    spin7_F_2 = Spinbox(tab7, from_=00, to=59, width=2)
    spin7_E_2.delete(0,"end")
    spin7_E_2.insert(0,"07")
    spin7_F_2.delete(0,"end")
    spin7_F_2.insert(0,"00")
    label7_h0_2 = Label(tab7, text='h')
    label7_m0_2 = Label(tab7, text='m')
    date7_2_entry = Spinbox(tab7, from_=00, to=31, width=4) 
    month7_2_entry = Spinbox(tab7, from_=00, to=12, width=4)
    year7_2_entry = Spinbox(tab7, from_=2018, to=2030, width=6) 
    date7_2_entry.delete(0,"end")
    date7_2_entry.insert(0,"DD")
    month7_2_entry.delete(0,"end")
    month7_2_entry.insert(0,"MM")
    year7_2_entry.delete(0,"end")
    year7_2_entry.insert(0,"YYYY")
    label7_d_2=Label(tab7, text= '/')
    label7_m_2=Label(tab7, text= '/')
    rad7_A_2 = Radiobutton(tab7, text='LD', variable=var7_2, value=1)
    lbl7_A_2 = Label(tab7, text= 'On:')
    spin7_A_2 = Spinbox(tab7, from_=00, to=24, width=2)
    spin7_B_2 = Spinbox(tab7, from_=00, to=59, width=2)
    spin7_A_2.delete(0,"end")
    spin7_A_2.insert(0,"07")
    spin7_B_2.delete(0,"end")
    spin7_B_2.insert(0,"00")
    label7_h1_2 = Label(tab7, text='h')
    label7_m1_2 = Label(tab7, text='m')
    lbl7_B_2 = Label(tab7, text= 'Off:')
    spin7_C_2 = Spinbox(tab7, from_=0, to=24, width=2)
    spin7_D_2 = Spinbox(tab7, from_=00, to=59, width=2)
    spin7_C_2.delete(0,"end")
    spin7_C_2.insert(0,"19")
    spin7_D_2.delete(0,"end")
    spin7_D_2.insert(0,"00")
    label7_h2_2 = Label(tab7, text='h')
    label7_m2_2 = Label(tab7, text='m')
    rad7_B_2 = Radiobutton(tab7, text='DD', variable=var7_2, value=2)
    rad7_C_2 = Radiobutton(tab7, text='LL', variable=var7_2, value=3)

    phaseLabel7_2.grid(column=0, row=2+row_adj, padx=15, pady=10)
    fromLabel7_2.grid(column=1,row=2+row_adj)
    spin7_E_2.grid(column=2,row=2+row_adj)
    label7_h0_2.grid(column=3,row=2+row_adj)
    spin7_F_2.grid(column=4,row=2+row_adj)
    label7_m0_2.grid(column=5,row=2+row_adj)
    space7_2.grid(column=6,row=2+row_adj,padx=5)
    date7_2_entry.grid(column=7, row=2+row_adj)
    label7_d_2.grid(column=8,row=2+row_adj)
    month7_2_entry.grid(column=9, row=2+row_adj)
    label7_m_2.grid(column=10,row=2+row_adj)
    year7_2_entry.grid(column=11, row=2+row_adj)
    rad7_A_2.grid(column=12, row=2+row_adj, padx=15, pady=10)
    lbl7_A_2.grid(column=13, row=2+row_adj, pady=10)
    spin7_A_2.grid(column=14,row=2+row_adj, pady=10)
    label7_h1_2.grid(column=15,row=2+row_adj, pady=10)
    spin7_B_2.grid(column=16,row=2+row_adj, pady=10)
    label7_m1_2.grid(column=17,row=2+row_adj, pady=10)
    lbl7_B_2.grid(column=18, row=2+row_adj, pady=10)
    spin7_C_2.grid(column=19,row=2+row_adj, pady=10)
    label7_h2_2.grid(column=20,row=2+row_adj, pady=10)
    spin7_D_2.grid(column=21,row=2+row_adj, pady=10)
    label7_m2_2.grid(column=22,row=2+row_adj, pady=10)
    rad7_B_2.grid(column=23, row=2+row_adj, padx=15, pady=10)
    rad7_C_2.grid(column=24, row=2+row_adj, pady=10)
        # phase 3
    phaseLabel7_3=Label(tab7, text='Phase 3')
    fromLabel7_3=Label(tab7, text='From:')
    space7_3=Label(tab7, text=" ")
    spin7_E_3 = Spinbox(tab7, from_=00, to=24, width=2)
    spin7_F_3 = Spinbox(tab7, from_=00, to=59, width=2)
    spin7_E_3.delete(0,"end")
    spin7_E_3.insert(0,"07")
    spin7_F_3.delete(0,"end")
    spin7_F_3.insert(0,"00")
    label7_h0_3 = Label(tab7, text='h')
    label7_m0_3 = Label(tab7, text='m')
    date7_3_entry = Spinbox(tab7, from_=00, to=31, width=4) 
    month7_3_entry = Spinbox(tab7, from_=00, to=12, width=4)
    year7_3_entry = Spinbox(tab7, from_=2018, to=2030, width=6) 
    date7_3_entry.delete(0,"end")
    date7_3_entry.insert(0,"DD")
    month7_3_entry.delete(0,"end")
    month7_3_entry.insert(0,"MM")
    year7_3_entry.delete(0,"end")
    year7_3_entry.insert(0,"YYYY")
    label7_d_3=Label(tab7, text= '/')
    label7_m_3=Label(tab7, text= '/')
    rad7_A_3 = Radiobutton(tab7, text='LD', variable=var7_3, value=1)
    lbl7_A_3 = Label(tab7, text= 'On:')
    spin7_A_3 = Spinbox(tab7, from_=00, to=24, width=2)
    spin7_B_3 = Spinbox(tab7, from_=00, to=59, width=2)
    spin7_A_3.delete(0,"end")
    spin7_A_3.insert(0,"07")
    spin7_B_3.delete(0,"end")
    spin7_B_3.insert(0,"00")
    label7_h1_3 = Label(tab7, text='h')
    label7_m1_3 = Label(tab7, text='m')
    lbl7_B_3 = Label(tab7, text= 'Off:')
    spin7_C_3 = Spinbox(tab7, from_=0, to=24, width=2)
    spin7_D_3 = Spinbox(tab7, from_=00, to=59, width=2)
    spin7_C_3.delete(0,"end")
    spin7_C_3.insert(0,"19")
    spin7_D_3.delete(0,"end")
    spin7_D_3.insert(0,"00")
    label7_h2_3 = Label(tab7, text='h')
    label7_m2_3 = Label(tab7, text='m')
    rad7_B_3 = Radiobutton(tab7, text='DD', variable=var7_3, value=2)
    rad7_C_3 = Radiobutton(tab7, text='LL', variable=var7_3, value=3)

    phaseLabel7_3.grid(column=0, row=3+row_adj, padx=15, pady=10)
    fromLabel7_3.grid(column=1,row=3+row_adj)
    spin7_E_3.grid(column=2,row=3+row_adj)
    label7_h0_3.grid(column=3,row=3+row_adj)
    spin7_F_3.grid(column=4,row=3+row_adj)
    label7_m0_3.grid(column=5,row=3+row_adj)
    space7_3.grid(column=6,row=3+row_adj,padx=5)
    date7_3_entry.grid(column=7, row=3+row_adj)
    label7_d_3.grid(column=8,row=3+row_adj)
    month7_3_entry.grid(column=9, row=3+row_adj)
    label7_m_3.grid(column=10,row=3+row_adj)
    year7_3_entry.grid(column=11, row=3+row_adj)
    rad7_A_3.grid(column=12, row=3+row_adj, padx=15, pady=10)
    lbl7_A_3.grid(column=13, row=3+row_adj, pady=10)
    spin7_A_3.grid(column=14,row=3+row_adj, pady=10)
    label7_h1_3.grid(column=15,row=3+row_adj, pady=10)
    spin7_B_3.grid(column=16,row=3+row_adj, pady=10)
    label7_m1_3.grid(column=17,row=3+row_adj, pady=10)
    lbl7_B_3.grid(column=18, row=3+row_adj, pady=10)
    spin7_C_3.grid(column=19,row=3+row_adj, pady=10)
    label7_h2_3.grid(column=20,row=3+row_adj, pady=10)
    spin7_D_3.grid(column=21,row=3+row_adj, pady=10)
    label7_m2_3.grid(column=22,row=3+row_adj, pady=10)
    rad7_B_3.grid(column=23, row=3+row_adj, padx=15, pady=10)
    rad7_C_3.grid(column=24, row=3+row_adj, pady=10)

    btn7.grid(column=25, row=4+row_adj, padx=25, pady=10)

    btn8 = Button(tab8, text="Set", command=getBox8Schedule)
    tab8_title = Label(tab8, text= 'LED schedule', anchor='center')
    tab8_title.grid(column=0, row= -1+row_adj, columnspan='20', sticky='we')
    capSep8 = ttk.Separator(tab8, orient=HORIZONTAL)
    capSep8.grid(column=0, row = -2+row_adj, columnspan='20', sticky='we')
        # phase 1
    phaseLabel8_1=Label(tab8, text='Phase 1')
    rad8_A_1 = Radiobutton(tab8, text='LD', variable=var8_1, value=1)
    lbl8_A_1 = Label(tab8, text= 'On:')
    spin8_A_1 = Spinbox(tab8, from_=00, to=24, width=2)
    spin8_B_1 = Spinbox(tab8, from_=00, to=59, width=2)
    spin8_A_1.delete(0,"end")
    spin8_A_1.insert(0,"07")
    spin8_B_1.delete(0,"end")
    spin8_B_1.insert(0,"00")
    label8_h1_1 = Label(tab8, text='h')
    label8_m1_1 = Label(tab8, text='m')
    lbl8_B_1 = Label(tab8, text= 'Off:')
    spin8_C_1 = Spinbox(tab8, from_=0, to=24, width=2)
    spin8_D_1 = Spinbox(tab8, from_=00, to=59, width=2)
    spin8_C_1.delete(0,"end")
    spin8_C_1.insert(0,"19")
    spin8_D_1.delete(0,"end")
    spin8_D_1.insert(0,"00")
    label8_h2_1 = Label(tab8, text='h')
    label8_m2_1 = Label(tab8, text='m')
    rad8_B_1 = Radiobutton(tab8, text='DD', variable=var8_1, value=2)
    rad8_C_1 = Radiobutton(tab8, text='LL', variable=var8_1, value=3)

    phaseLabel8_1.grid(column=0, row=1+row_adj, padx=15, pady=10)

    rad8_A_1.grid(column=12, row=1+row_adj, padx=15, pady=10)
    lbl8_A_1.grid(column=13, row=1+row_adj, pady=10)
    spin8_A_1.grid(column=14,row=1+row_adj, pady=10)
    label8_h1_1.grid(column=15,row=1+row_adj, pady=10, sticky='w')
    spin8_B_1.grid(column=16,row=1+row_adj, pady=10)
    label8_m1_1.grid(column=17,row=1+row_adj, pady=10, sticky='w')
    lbl8_B_1.grid(column=18, row=1+row_adj, pady=10)
    spin8_C_1.grid(column=19,row=1+row_adj, pady=10)
    label8_h2_1.grid(column=20,row=1+row_adj, pady=10, sticky='w')
    spin8_D_1.grid(column=21,row=1+row_adj, pady=10)
    label8_m2_1.grid(column=22,row=1+row_adj, pady=10, sticky='w')
    rad8_B_1.grid(column=23, row=1+row_adj, padx=15, pady=10)
    rad8_C_1.grid(column=24, row=1+row_adj, pady=10)

        # phase 2
    phaseLabel8_2=Label(tab8, text='Phase 2')
    fromLabel8_2=Label(tab8, text='From:')
    space8_2=Label(tab8, text=" ")
    spin8_E_2 = Spinbox(tab8, from_=00, to=24, width=2)
    spin8_F_2 = Spinbox(tab8, from_=00, to=59, width=2)
    spin8_E_2.delete(0,"end")
    spin8_E_2.insert(0,"07")
    spin8_F_2.delete(0,"end")
    spin8_F_2.insert(0,"00")
    label8_h0_2 = Label(tab8, text='h')
    label8_m0_2 = Label(tab8, text='m')
    date8_2_entry = Spinbox(tab8, from_=00, to=31, width=4) 
    month8_2_entry = Spinbox(tab8, from_=00, to=12, width=4)
    year8_2_entry = Spinbox(tab8, from_=2018, to=2030, width=6) 
    date8_2_entry.delete(0,"end")
    date8_2_entry.insert(0,"DD")
    month8_2_entry.delete(0,"end")
    month8_2_entry.insert(0,"MM")
    year8_2_entry.delete(0,"end")
    year8_2_entry.insert(0,"YYYY")
    label8_d_2=Label(tab8, text= '/')
    label8_m_2=Label(tab8, text= '/')
    rad8_A_2 = Radiobutton(tab8, text='LD', variable=var8_2, value=1)
    lbl8_A_2 = Label(tab8, text= 'On:')
    spin8_A_2 = Spinbox(tab8, from_=00, to=24, width=2)
    spin8_B_2 = Spinbox(tab8, from_=00, to=59, width=2)
    spin8_A_2.delete(0,"end")
    spin8_A_2.insert(0,"07")
    spin8_B_2.delete(0,"end")
    spin8_B_2.insert(0,"00")
    label8_h1_2 = Label(tab8, text='h')
    label8_m1_2 = Label(tab8, text='m')
    lbl8_B_2 = Label(tab8, text= 'Off:')
    spin8_C_2 = Spinbox(tab8, from_=0, to=24, width=2)
    spin8_D_2 = Spinbox(tab8, from_=00, to=59, width=2)
    spin8_C_2.delete(0,"end")
    spin8_C_2.insert(0,"19")
    spin8_D_2.delete(0,"end")
    spin8_D_2.insert(0,"00")
    label8_h2_2 = Label(tab8, text='h')
    label8_m2_2 = Label(tab8, text='m')
    rad8_B_2 = Radiobutton(tab8, text='DD', variable=var8_2, value=2)
    rad8_C_2 = Radiobutton(tab8, text='LL', variable=var8_2, value=3)

    phaseLabel8_2.grid(column=0, row=2+row_adj, padx=15, pady=10)
    fromLabel8_2.grid(column=1,row=2+row_adj)
    spin8_E_2.grid(column=2,row=2+row_adj)
    label8_h0_2.grid(column=3,row=2+row_adj)
    spin8_F_2.grid(column=4,row=2+row_adj)
    label8_m0_2.grid(column=5,row=2+row_adj)
    space8_2.grid(column=6,row=2+row_adj,padx=5)
    date8_2_entry.grid(column=7, row=2+row_adj)
    label8_d_2.grid(column=8,row=2+row_adj)
    month8_2_entry.grid(column=9, row=2+row_adj)
    label8_m_2.grid(column=10,row=2+row_adj)
    year8_2_entry.grid(column=11, row=2+row_adj)
    rad8_A_2.grid(column=12, row=2+row_adj, padx=15, pady=10)
    lbl8_A_2.grid(column=13, row=2+row_adj, pady=10)
    spin8_A_2.grid(column=14,row=2+row_adj, pady=10)
    label8_h1_2.grid(column=15,row=2+row_adj, pady=10)
    spin8_B_2.grid(column=16,row=2+row_adj, pady=10)
    label8_m1_2.grid(column=17,row=2+row_adj, pady=10)
    lbl8_B_2.grid(column=18, row=2+row_adj, pady=10)
    spin8_C_2.grid(column=19,row=2+row_adj, pady=10)
    label8_h2_2.grid(column=20,row=2+row_adj, pady=10)
    spin8_D_2.grid(column=21,row=2+row_adj, pady=10)
    label8_m2_2.grid(column=22,row=2+row_adj, pady=10)
    rad8_B_2.grid(column=23, row=2+row_adj, padx=15, pady=10)
    rad8_C_2.grid(column=24, row=2+row_adj, pady=10)
        # phase 3
    phaseLabel8_3=Label(tab8, text='Phase 3')
    fromLabel8_3=Label(tab8, text='From:')
    space8_3=Label(tab8, text=" ")
    spin8_E_3 = Spinbox(tab8, from_=00, to=24, width=2)
    spin8_F_3 = Spinbox(tab8, from_=00, to=59, width=2)
    spin8_E_3.delete(0,"end")
    spin8_E_3.insert(0,"07")
    spin8_F_3.delete(0,"end")
    spin8_F_3.insert(0,"00")
    label8_h0_3 = Label(tab8, text='h')
    label8_m0_3 = Label(tab8, text='m')
    date8_3_entry = Spinbox(tab8, from_=00, to=31, width=4) 
    month8_3_entry = Spinbox(tab8, from_=00, to=12, width=4)
    year8_3_entry = Spinbox(tab8, from_=2018, to=2030, width=6) 
    date8_3_entry.delete(0,"end")
    date8_3_entry.insert(0,"DD")
    month8_3_entry.delete(0,"end")
    month8_3_entry.insert(0,"MM")
    year8_3_entry.delete(0,"end")
    year8_3_entry.insert(0,"YYYY")
    label8_d_3=Label(tab8, text= '/')
    label8_m_3=Label(tab8, text= '/')
    rad8_A_3 = Radiobutton(tab8, text='LD', variable=var8_3, value=1)
    lbl8_A_3 = Label(tab8, text= 'On:')
    spin8_A_3 = Spinbox(tab8, from_=00, to=24, width=2)
    spin8_B_3 = Spinbox(tab8, from_=00, to=59, width=2)
    spin8_A_3.delete(0,"end")
    spin8_A_3.insert(0,"07")
    spin8_B_3.delete(0,"end")
    spin8_B_3.insert(0,"00")
    label8_h1_3 = Label(tab8, text='h')
    label8_m1_3 = Label(tab8, text='m')
    lbl8_B_3 = Label(tab8, text= 'Off:')
    spin8_C_3 = Spinbox(tab8, from_=0, to=24, width=2)
    spin8_D_3 = Spinbox(tab8, from_=00, to=59, width=2)
    spin8_C_3.delete(0,"end")
    spin8_C_3.insert(0,"19")
    spin8_D_3.delete(0,"end")
    spin8_D_3.insert(0,"00")
    label8_h2_3 = Label(tab8, text='h')
    label8_m2_3 = Label(tab8, text='m')
    rad8_B_3 = Radiobutton(tab8, text='DD', variable=var8_3, value=2)
    rad8_C_3 = Radiobutton(tab8, text='LL', variable=var8_3, value=3)

    phaseLabel8_3.grid(column=0, row=3+row_adj, padx=15, pady=10)
    fromLabel8_3.grid(column=1,row=3+row_adj)
    spin8_E_3.grid(column=2,row=3+row_adj)
    label8_h0_3.grid(column=3,row=3+row_adj)
    spin8_F_3.grid(column=4,row=3+row_adj)
    label8_m0_3.grid(column=5,row=3+row_adj)
    space8_3.grid(column=6,row=3+row_adj,padx=5)
    date8_3_entry.grid(column=7, row=3+row_adj)
    label8_d_3.grid(column=8,row=3+row_adj)
    month8_3_entry.grid(column=9, row=3+row_adj)
    label8_m_3.grid(column=10,row=3+row_adj)
    year8_3_entry.grid(column=11, row=3+row_adj)
    rad8_A_3.grid(column=12, row=3+row_adj, padx=15, pady=10)
    lbl8_A_3.grid(column=13, row=3+row_adj, pady=10)
    spin8_A_3.grid(column=14,row=3+row_adj, pady=10)
    label8_h1_3.grid(column=15,row=3+row_adj, pady=10)
    spin8_B_3.grid(column=16,row=3+row_adj, pady=10)
    label8_m1_3.grid(column=17,row=3+row_adj, pady=10)
    lbl8_B_3.grid(column=18, row=3+row_adj, pady=10)
    spin8_C_3.grid(column=19,row=3+row_adj, pady=10)
    label8_h2_3.grid(column=20,row=3+row_adj, pady=10)
    spin8_D_3.grid(column=21,row=3+row_adj, pady=10)
    label8_m2_3.grid(column=22,row=3+row_adj, pady=10)
    rad8_B_3.grid(column=23, row=3+row_adj, padx=15, pady=10)
    rad8_C_3.grid(column=24, row=3+row_adj, pady=10)

    btn8.grid(column=25, row=4+row_adj, padx=25, pady=10)

    # Box9
    btn9 = Button(tab9, text="Set", command=getBox9Schedule)
    tab9_title = Label(tab9, text= 'LED schedule', anchor='center')
    tab9_title.grid(column=0, row= -1+row_adj, columnspan='20', sticky='we')
    capSep9 = ttk.Separator(tab9, orient=HORIZONTAL)
    capSep9.grid(column=0, row = -2+row_adj, columnspan='20', sticky='we')
        # phase 1
    phaseLabel9_1=Label(tab9, text='Phase 1')
    rad9_A_1 = Radiobutton(tab9, text='LD', variable=var9_1, value=1)
    lbl9_A_1 = Label(tab9, text= 'On:')
    spin9_A_1 = Spinbox(tab9, from_=00, to=24, width=2)
    spin9_B_1 = Spinbox(tab9, from_=00, to=59, width=2)
    spin9_A_1.delete(0,"end")
    spin9_A_1.insert(0,"07")
    spin9_B_1.delete(0,"end")
    spin9_B_1.insert(0,"00")
    label9_h1_1 = Label(tab9, text='h')
    label9_m1_1 = Label(tab9, text='m')
    lbl9_B_1 = Label(tab9, text= 'Off:')
    spin9_C_1 = Spinbox(tab9, from_=0, to=24, width=2)
    spin9_D_1 = Spinbox(tab9, from_=00, to=59, width=2)
    spin9_C_1.delete(0,"end")
    spin9_C_1.insert(0,"19")
    spin9_D_1.delete(0,"end")
    spin9_D_1.insert(0,"00")
    label9_h2_1 = Label(tab9, text='h')
    label9_m2_1 = Label(tab9, text='m')
    rad9_B_1 = Radiobutton(tab9, text='DD', variable=var9_1, value=2)
    rad9_C_1 = Radiobutton(tab9, text='LL', variable=var9_1, value=3)

    phaseLabel9_1.grid(column=0, row=1+row_adj, padx=15, pady=10)

    rad9_A_1.grid(column=12, row=1+row_adj, padx=15, pady=10)
    lbl9_A_1.grid(column=13, row=1+row_adj, pady=10)
    spin9_A_1.grid(column=14,row=1+row_adj, pady=10)
    label9_h1_1.grid(column=15,row=1+row_adj, pady=10, sticky='w')
    spin9_B_1.grid(column=16,row=1+row_adj, pady=10)
    label9_m1_1.grid(column=17,row=1+row_adj, pady=10, sticky='w')
    lbl9_B_1.grid(column=18, row=1+row_adj, pady=10)
    spin9_C_1.grid(column=19,row=1+row_adj, pady=10)
    label9_h2_1.grid(column=20,row=1+row_adj, pady=10, sticky='w')
    spin9_D_1.grid(column=21,row=1+row_adj, pady=10)
    label9_m2_1.grid(column=22,row=1+row_adj, pady=10, sticky='w')
    rad9_B_1.grid(column=23, row=1+row_adj, padx=15, pady=10)
    rad9_C_1.grid(column=24, row=1+row_adj, pady=10)

        # phase 2
    phaseLabel9_2=Label(tab9, text='Phase 2')
    fromLabel9_2=Label(tab9, text='From:')
    space9_2=Label(tab9, text=" ")
    spin9_E_2 = Spinbox(tab9, from_=00, to=24, width=2)
    spin9_F_2 = Spinbox(tab9, from_=00, to=59, width=2)
    spin9_E_2.delete(0,"end")
    spin9_E_2.insert(0,"07")
    spin9_F_2.delete(0,"end")
    spin9_F_2.insert(0,"00")
    label9_h0_2 = Label(tab9, text='h')
    label9_m0_2 = Label(tab9, text='m')
    date9_2_entry = Spinbox(tab9, from_=00, to=31, width=4) 
    month9_2_entry = Spinbox(tab9, from_=00, to=12, width=4)
    year9_2_entry = Spinbox(tab9, from_=2018, to=2030, width=6) 
    date9_2_entry.delete(0,"end")
    date9_2_entry.insert(0,"DD")
    month9_2_entry.delete(0,"end")
    month9_2_entry.insert(0,"MM")
    year9_2_entry.delete(0,"end")
    year9_2_entry.insert(0,"YYYY")
    label9_d_2=Label(tab9, text= '/')
    label9_m_2=Label(tab9, text= '/')
    rad9_A_2 = Radiobutton(tab9, text='LD', variable=var9_2, value=1)
    lbl9_A_2 = Label(tab9, text= 'On:')
    spin9_A_2 = Spinbox(tab9, from_=00, to=24, width=2)
    spin9_B_2 = Spinbox(tab9, from_=00, to=59, width=2)
    spin9_A_2.delete(0,"end")
    spin9_A_2.insert(0,"07")
    spin9_B_2.delete(0,"end")
    spin9_B_2.insert(0,"00")
    label9_h1_2 = Label(tab9, text='h')
    label9_m1_2 = Label(tab9, text='m')
    lbl9_B_2 = Label(tab9, text= 'Off:')
    spin9_C_2 = Spinbox(tab9, from_=0, to=24, width=2)
    spin9_D_2 = Spinbox(tab9, from_=00, to=59, width=2)
    spin9_C_2.delete(0,"end")
    spin9_C_2.insert(0,"19")
    spin9_D_2.delete(0,"end")
    spin9_D_2.insert(0,"00")
    label9_h2_2 = Label(tab9, text='h')
    label9_m2_2 = Label(tab9, text='m')
    rad9_B_2 = Radiobutton(tab9, text='DD', variable=var9_2, value=2)
    rad9_C_2 = Radiobutton(tab9, text='LL', variable=var9_2, value=3)

    phaseLabel9_2.grid(column=0, row=2+row_adj, padx=15, pady=10)
    fromLabel9_2.grid(column=1,row=2+row_adj)
    spin9_E_2.grid(column=2,row=2+row_adj)
    label9_h0_2.grid(column=3,row=2+row_adj)
    spin9_F_2.grid(column=4,row=2+row_adj)
    label9_m0_2.grid(column=5,row=2+row_adj)
    space9_2.grid(column=6,row=2+row_adj,padx=5)
    date9_2_entry.grid(column=7, row=2+row_adj)
    label9_d_2.grid(column=8,row=2+row_adj)
    month9_2_entry.grid(column=9, row=2+row_adj)
    label9_m_2.grid(column=10,row=2+row_adj)
    year9_2_entry.grid(column=11, row=2+row_adj)
    rad9_A_2.grid(column=12, row=2+row_adj, padx=15, pady=10)
    lbl9_A_2.grid(column=13, row=2+row_adj, pady=10)
    spin9_A_2.grid(column=14,row=2+row_adj, pady=10)
    label9_h1_2.grid(column=15,row=2+row_adj, pady=10)
    spin9_B_2.grid(column=16,row=2+row_adj, pady=10)
    label9_m1_2.grid(column=17,row=2+row_adj, pady=10)
    lbl9_B_2.grid(column=18, row=2+row_adj, pady=10)
    spin9_C_2.grid(column=19,row=2+row_adj, pady=10)
    label9_h2_2.grid(column=20,row=2+row_adj, pady=10)
    spin9_D_2.grid(column=21,row=2+row_adj, pady=10)
    label9_m2_2.grid(column=22,row=2+row_adj, pady=10)
    rad9_B_2.grid(column=23, row=2+row_adj, padx=15, pady=10)
    rad9_C_2.grid(column=24, row=2+row_adj, pady=10)
        # phase 3
    phaseLabel9_3=Label(tab9, text='Phase 3')
    fromLabel9_3=Label(tab9, text='From:')
    space9_3=Label(tab9, text=" ")
    spin9_E_3 = Spinbox(tab9, from_=00, to=24, width=2)
    spin9_F_3 = Spinbox(tab9, from_=00, to=59, width=2)
    spin9_E_3.delete(0,"end")
    spin9_E_3.insert(0,"07")
    spin9_F_3.delete(0,"end")
    spin9_F_3.insert(0,"00")
    label9_h0_3 = Label(tab9, text='h')
    label9_m0_3 = Label(tab9, text='m')
    date9_3_entry = Spinbox(tab9, from_=00, to=31, width=4) 
    month9_3_entry = Spinbox(tab9, from_=00, to=12, width=4)
    year9_3_entry = Spinbox(tab9, from_=2018, to=2030, width=6) 
    date9_3_entry.delete(0,"end")
    date9_3_entry.insert(0,"DD")
    month9_3_entry.delete(0,"end")
    month9_3_entry.insert(0,"MM")
    year9_3_entry.delete(0,"end")
    year9_3_entry.insert(0,"YYYY")
    label9_d_3=Label(tab9, text= '/')
    label9_m_3=Label(tab9, text= '/')
    rad9_A_3 = Radiobutton(tab9, text='LD', variable=var9_3, value=1)
    lbl9_A_3 = Label(tab9, text= 'On:')
    spin9_A_3 = Spinbox(tab9, from_=00, to=24, width=2)
    spin9_B_3 = Spinbox(tab9, from_=00, to=59, width=2)
    spin9_A_3.delete(0,"end")
    spin9_A_3.insert(0,"07")
    spin9_B_3.delete(0,"end")
    spin9_B_3.insert(0,"00")
    label9_h1_3 = Label(tab9, text='h')
    label9_m1_3 = Label(tab9, text='m')
    lbl9_B_3 = Label(tab9, text= 'Off:')
    spin9_C_3 = Spinbox(tab9, from_=0, to=24, width=2)
    spin9_D_3 = Spinbox(tab9, from_=00, to=59, width=2)
    spin9_C_3.delete(0,"end")
    spin9_C_3.insert(0,"19")
    spin9_D_3.delete(0,"end")
    spin9_D_3.insert(0,"00")
    label9_h2_3 = Label(tab9, text='h')
    label9_m2_3 = Label(tab9, text='m')
    rad9_B_3 = Radiobutton(tab9, text='DD', variable=var9_3, value=2)
    rad9_C_3 = Radiobutton(tab9, text='LL', variable=var9_3, value=3)

    phaseLabel9_3.grid(column=0, row=3+row_adj, padx=15, pady=10)
    fromLabel9_3.grid(column=1,row=3+row_adj)
    spin9_E_3.grid(column=2,row=3+row_adj)
    label9_h0_3.grid(column=3,row=3+row_adj)
    spin9_F_3.grid(column=4,row=3+row_adj)
    label9_m0_3.grid(column=5,row=3+row_adj)
    space9_3.grid(column=6,row=3+row_adj,padx=5)
    date9_3_entry.grid(column=7, row=3+row_adj)
    label9_d_3.grid(column=8,row=3+row_adj)
    month9_3_entry.grid(column=9, row=3+row_adj)
    label9_m_3.grid(column=10,row=3+row_adj)
    year9_3_entry.grid(column=11, row=3+row_adj)
    rad9_A_3.grid(column=12, row=3+row_adj, padx=15, pady=10)
    lbl9_A_3.grid(column=13, row=3+row_adj, pady=10)
    spin9_A_3.grid(column=14,row=3+row_adj, pady=10)
    label9_h1_3.grid(column=15,row=3+row_adj, pady=10)
    spin9_B_3.grid(column=16,row=3+row_adj, pady=10)
    label9_m1_3.grid(column=17,row=3+row_adj, pady=10)
    lbl9_B_3.grid(column=18, row=3+row_adj, pady=10)
    spin9_C_3.grid(column=19,row=3+row_adj, pady=10)
    label9_h2_3.grid(column=20,row=3+row_adj, pady=10)
    spin9_D_3.grid(column=21,row=3+row_adj, pady=10)
    label9_m2_3.grid(column=22,row=3+row_adj, pady=10)
    rad9_B_3.grid(column=23, row=3+row_adj, padx=15, pady=10)
    rad9_C_3.grid(column=24, row=3+row_adj, pady=10)

    btn9.grid(column=25, row=4+row_adj, padx=25, pady=10)

    btn10 = Button(tab10, text="Set", command=getBox10Schedule)
    tab10_title = Label(tab10, text= 'LED schedule', anchor='center')
    tab10_title.grid(column=0, row= -1+row_adj, columnspan='20', sticky='we')
    capSep10 = ttk.Separator(tab10, orient=HORIZONTAL)
    capSep10.grid(column=0, row = -2+row_adj, columnspan='20', sticky='we')
        # phase 1
    phaseLabel10_1=Label(tab10, text='Phase 1')
    rad10_A_1 = Radiobutton(tab10, text='LD', variable=var10_1, value=1)
    lbl10_A_1 = Label(tab10, text= 'On:')
    spin10_A_1 = Spinbox(tab10, from_=00, to=24, width=2)
    spin10_B_1 = Spinbox(tab10, from_=00, to=59, width=2)
    spin10_A_1.delete(0,"end")
    spin10_A_1.insert(0,"07")
    spin10_B_1.delete(0,"end")
    spin10_B_1.insert(0,"00")
    label10_h1_1 = Label(tab10, text='h')
    label10_m1_1 = Label(tab10, text='m')
    lbl10_B_1 = Label(tab10, text= 'Off:')
    spin10_C_1 = Spinbox(tab10, from_=0, to=24, width=2)
    spin10_D_1 = Spinbox(tab10, from_=00, to=59, width=2)
    spin10_C_1.delete(0,"end")
    spin10_C_1.insert(0,"19")
    spin10_D_1.delete(0,"end")
    spin10_D_1.insert(0,"00")
    label10_h2_1 = Label(tab10, text='h')
    label10_m2_1 = Label(tab10, text='m')
    rad10_B_1 = Radiobutton(tab10, text='DD', variable=var10_1, value=2)
    rad10_C_1 = Radiobutton(tab10, text='LL', variable=var10_1, value=3)

    phaseLabel10_1.grid(column=0, row=1+row_adj, padx=15, pady=10)

    rad10_A_1.grid(column=12, row=1+row_adj, padx=15, pady=10)
    lbl10_A_1.grid(column=13, row=1+row_adj, pady=10)
    spin10_A_1.grid(column=14,row=1+row_adj, pady=10)
    label10_h1_1.grid(column=15,row=1+row_adj, pady=10, sticky='w')
    spin10_B_1.grid(column=16,row=1+row_adj, pady=10)
    label10_m1_1.grid(column=17,row=1+row_adj, pady=10, sticky='w')
    lbl10_B_1.grid(column=18, row=1+row_adj, pady=10)
    spin10_C_1.grid(column=19,row=1+row_adj, pady=10)
    label10_h2_1.grid(column=20,row=1+row_adj, pady=10, sticky='w')
    spin10_D_1.grid(column=21,row=1+row_adj, pady=10)
    label10_m2_1.grid(column=22,row=1+row_adj, pady=10, sticky='w')
    rad10_B_1.grid(column=23, row=1+row_adj, padx=15, pady=10)
    rad10_C_1.grid(column=24, row=1+row_adj, pady=10)

        # phase 2
    phaseLabel10_2=Label(tab10, text='Phase 2')
    fromLabel10_2=Label(tab10, text='From:')
    space10_2=Label(tab10, text=" ")
    spin10_E_2 = Spinbox(tab10, from_=00, to=24, width=2)
    spin10_F_2 = Spinbox(tab10, from_=00, to=59, width=2)
    spin10_E_2.delete(0,"end")
    spin10_E_2.insert(0,"07")
    spin10_F_2.delete(0,"end")
    spin10_F_2.insert(0,"00")
    label10_h0_2 = Label(tab10, text='h')
    label10_m0_2 = Label(tab10, text='m')
    date10_2_entry = Spinbox(tab10, from_=00, to=31, width=4) 
    month10_2_entry = Spinbox(tab10, from_=00, to=12, width=4)
    year10_2_entry = Spinbox(tab10, from_=2018, to=2030, width=6) 
    date10_2_entry.delete(0,"end")
    date10_2_entry.insert(0,"DD")
    month10_2_entry.delete(0,"end")
    month10_2_entry.insert(0,"MM")
    year10_2_entry.delete(0,"end")
    year10_2_entry.insert(0,"YYYY")
    label10_d_2=Label(tab10, text= '/')
    label10_m_2=Label(tab10, text= '/')
    rad10_A_2 = Radiobutton(tab10, text='LD', variable=var10_2, value=1)
    lbl10_A_2 = Label(tab10, text= 'On:')
    spin10_A_2 = Spinbox(tab10, from_=00, to=24, width=2)
    spin10_B_2 = Spinbox(tab10, from_=00, to=59, width=2)
    spin10_A_2.delete(0,"end")
    spin10_A_2.insert(0,"07")
    spin10_B_2.delete(0,"end")
    spin10_B_2.insert(0,"00")
    label10_h1_2 = Label(tab10, text='h')
    label10_m1_2 = Label(tab10, text='m')
    lbl10_B_2 = Label(tab10, text= 'Off:')
    spin10_C_2 = Spinbox(tab10, from_=0, to=24, width=2)
    spin10_D_2 = Spinbox(tab10, from_=00, to=59, width=2)
    spin10_C_2.delete(0,"end")
    spin10_C_2.insert(0,"19")
    spin10_D_2.delete(0,"end")
    spin10_D_2.insert(0,"00")
    label10_h2_2 = Label(tab10, text='h')
    label10_m2_2 = Label(tab10, text='m')
    rad10_B_2 = Radiobutton(tab10, text='DD', variable=var10_2, value=2)
    rad10_C_2 = Radiobutton(tab10, text='LL', variable=var10_2, value=3)

    phaseLabel10_2.grid(column=0, row=2+row_adj, padx=15, pady=10)
    fromLabel10_2.grid(column=1,row=2+row_adj)
    spin10_E_2.grid(column=2,row=2+row_adj)
    label10_h0_2.grid(column=3,row=2+row_adj)
    spin10_F_2.grid(column=4,row=2+row_adj)
    label10_m0_2.grid(column=5,row=2+row_adj)
    space10_2.grid(column=6,row=2+row_adj,padx=5)
    date10_2_entry.grid(column=7, row=2+row_adj)
    label10_d_2.grid(column=8,row=2+row_adj)
    month10_2_entry.grid(column=9, row=2+row_adj)
    label10_m_2.grid(column=10,row=2+row_adj)
    year10_2_entry.grid(column=11, row=2+row_adj)
    rad10_A_2.grid(column=12, row=2+row_adj, padx=15, pady=10)
    lbl10_A_2.grid(column=13, row=2+row_adj, pady=10)
    spin10_A_2.grid(column=14,row=2+row_adj, pady=10)
    label10_h1_2.grid(column=15,row=2+row_adj, pady=10)
    spin10_B_2.grid(column=16,row=2+row_adj, pady=10)
    label10_m1_2.grid(column=17,row=2+row_adj, pady=10)
    lbl10_B_2.grid(column=18, row=2+row_adj, pady=10)
    spin10_C_2.grid(column=19,row=2+row_adj, pady=10)
    label10_h2_2.grid(column=20,row=2+row_adj, pady=10)
    spin10_D_2.grid(column=21,row=2+row_adj, pady=10)
    label10_m2_2.grid(column=22,row=2+row_adj, pady=10)
    rad10_B_2.grid(column=23, row=2+row_adj, padx=15, pady=10)
    rad10_C_2.grid(column=24, row=2+row_adj, pady=10)
        # phase 3
    phaseLabel10_3=Label(tab10, text='Phase 3')
    fromLabel10_3=Label(tab10, text='From:')
    space10_3=Label(tab10, text=" ")
    spin10_E_3 = Spinbox(tab10, from_=00, to=24, width=2)
    spin10_F_3 = Spinbox(tab10, from_=00, to=59, width=2)
    spin10_E_3.delete(0,"end")
    spin10_E_3.insert(0,"07")
    spin10_F_3.delete(0,"end")
    spin10_F_3.insert(0,"00")
    label10_h0_3 = Label(tab10, text='h')
    label10_m0_3 = Label(tab10, text='m')
    date10_3_entry = Spinbox(tab10, from_=00, to=31, width=4) 
    month10_3_entry = Spinbox(tab10, from_=00, to=12, width=4)
    year10_3_entry = Spinbox(tab10, from_=2018, to=2030, width=6) 
    date10_3_entry.delete(0,"end")
    date10_3_entry.insert(0,"DD")
    month10_3_entry.delete(0,"end")
    month10_3_entry.insert(0,"MM")
    year10_3_entry.delete(0,"end")
    year10_3_entry.insert(0,"YYYY")
    label10_d_3=Label(tab10, text= '/')
    label10_m_3=Label(tab10, text= '/')
    rad10_A_3 = Radiobutton(tab10, text='LD', variable=var10_3, value=1)
    lbl10_A_3 = Label(tab10, text= 'On:')
    spin10_A_3 = Spinbox(tab10, from_=00, to=24, width=2)
    spin10_B_3 = Spinbox(tab10, from_=00, to=59, width=2)
    spin10_A_3.delete(0,"end")
    spin10_A_3.insert(0,"07")
    spin10_B_3.delete(0,"end")
    spin10_B_3.insert(0,"00")
    label10_h1_3 = Label(tab10, text='h')
    label10_m1_3 = Label(tab10, text='m')
    lbl10_B_3 = Label(tab10, text= 'Off:')
    spin10_C_3 = Spinbox(tab10, from_=0, to=24, width=2)
    spin10_D_3 = Spinbox(tab10, from_=00, to=59, width=2)
    spin10_C_3.delete(0,"end")
    spin10_C_3.insert(0,"19")
    spin10_D_3.delete(0,"end")
    spin10_D_3.insert(0,"00")
    label10_h2_3 = Label(tab10, text='h')
    label10_m2_3 = Label(tab10, text='m')
    rad10_B_3 = Radiobutton(tab10, text='DD', variable=var10_3, value=2)
    rad10_C_3 = Radiobutton(tab10, text='LL', variable=var10_3, value=3)

    phaseLabel10_3.grid(column=0, row=3+row_adj, padx=15, pady=10)
    fromLabel10_3.grid(column=1,row=3+row_adj)
    spin10_E_3.grid(column=2,row=3+row_adj)
    label10_h0_3.grid(column=3,row=3+row_adj)
    spin10_F_3.grid(column=4,row=3+row_adj)
    label10_m0_3.grid(column=5,row=3+row_adj)
    space10_3.grid(column=6,row=3+row_adj,padx=5)
    date10_3_entry.grid(column=7, row=3+row_adj)
    label10_d_3.grid(column=8,row=3+row_adj)
    month10_3_entry.grid(column=9, row=3+row_adj)
    label10_m_3.grid(column=10,row=3+row_adj)
    year10_3_entry.grid(column=11, row=3+row_adj)
    rad10_A_3.grid(column=12, row=3+row_adj, padx=15, pady=10)
    lbl10_A_3.grid(column=13, row=3+row_adj, pady=10)
    spin10_A_3.grid(column=14,row=3+row_adj, pady=10)
    label10_h1_3.grid(column=15,row=3+row_adj, pady=10)
    spin10_B_3.grid(column=16,row=3+row_adj, pady=10)
    label10_m1_3.grid(column=17,row=3+row_adj, pady=10)
    lbl10_B_3.grid(column=18, row=3+row_adj, pady=10)
    spin10_C_3.grid(column=19,row=3+row_adj, pady=10)
    label10_h2_3.grid(column=20,row=3+row_adj, pady=10)
    spin10_D_3.grid(column=21,row=3+row_adj, pady=10)
    label10_m2_3.grid(column=22,row=3+row_adj, pady=10)
    rad10_B_3.grid(column=23, row=3+row_adj, padx=15, pady=10)
    rad10_C_3.grid(column=24, row=3+row_adj, pady=10)

    btn10.grid(column=25, row=4+row_adj, padx=25, pady=10)



    tab_control.pack(expand=1, fill='both')


    ### Main loop
    window.mainloop()



